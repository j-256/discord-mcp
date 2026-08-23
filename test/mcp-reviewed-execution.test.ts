import assert from "node:assert/strict"
import test from "node:test"

import {
  runReviewedToolExecution,
  type ReviewedToolExecutionOptions,
} from "../src/mcp-reviewed-execution.js"

const PLAN_DIGEST = "hmac-sha256:1111111111111111111111111111111111111111111111111111111111111111"
const CHANGED_DIGEST = "hmac-sha256:2222222222222222222222222222222222222222222222222222222222222222"
const REQUEST_STATE = Object.freeze({ signed: true })
const CONFIRMATION_KEY = "confirm_change"

interface Plan {
  digest: string
  writeRequired: boolean
}

interface CompleteResult {
  isError: boolean
  result: object
  summary: string
}

interface Fixture {
  options: ReviewedToolExecutionOptions<Plan, { status: string }, CompleteResult>
  statePayloads: object[]
  trace: string[]
}

function fixture(
  overrides: Partial<ReviewedToolExecutionOptions<Plan, { status: string }, CompleteResult>> = {},
): Fixture {
  const trace: string[] = []
  const statePayloads: object[] = []
  const options: ReviewedToolExecutionOptions<Plan, { status: string }, CompleteResult> = {
    confirmation: {
      approvalRequiredReason: "Explicit approval is required",
      declinedReason(action) {
        return action === "cancel"
          ? "Confirmation was canceled"
          : "Confirmation was declined"
      },
      invalidStateReason: "Signed state did not match",
      key: CONFIRMATION_KEY,
      message: () => "Approve the exact reviewed change?",
      missingStateReason: "Responses require signed state",
      requestedSchema: {
        properties: { approve: { type: "boolean" } },
        required: ["approve"],
        type: "object",
      },
    },
    async execute() {
      trace.push("execute")
      return { status: "completed" }
    },
    inputResponses: undefined,
    async mintRequestState(payload) {
      trace.push("mint")
      statePayloads.push(payload)
      return "signed-request-state"
    },
    outcome(status, reason) {
      trace.push(`outcome:${status}`)
      return { reason, status }
    },
    async plan() {
      trace.push("plan")
      return { digest: PLAN_DIGEST, writeRequired: true }
    },
    planChanged(plan) {
      trace.push("plan-changed")
      return {
        result: { actualDigest: plan.digest, status: "plan-changed" },
        summary: "The reviewed plan changed",
      }
    },
    planDigest: PLAN_DIGEST,
    render(result, summary, renderOptions = {}) {
      trace.push(`render:${renderOptions.isError === true ? "error" : "ok"}`)
      return {
        isError: renderOptions.isError === true,
        result,
        summary,
      }
    },
    requestState: undefined,
    requestStatePayload: { exactRequest: "bound" },
    summarizeExecution(result) {
      return `Execution ${result.status}`
    },
    summarizeNoWrite(result) {
      return `No write ${result.status}`
    },
    validRequestState(value) {
      trace.push("validate-state")
      return value === REQUEST_STATE
    },
    ...overrides,
  }
  return { options, statePayloads, trace }
}

test("reviewed execution plans before minting exact input-required state", async () => {
  const current = fixture()
  const result = await runReviewedToolExecution(current.options)

  assert.equal("resultType" in result && result.resultType, "input_required")
  if (!("resultType" in result)) assert.fail("Expected input-required result")
  assert.equal(result.requestState, "signed-request-state")
  assert.deepEqual(current.statePayloads, [{
    exactRequest: "bound",
    planDigest: PLAN_DIGEST,
  }])
  assert.deepEqual(result.inputRequests?.[CONFIRMATION_KEY], {
    method: "elicitation/create",
    params: {
      message: "Approve the exact reviewed change?",
      mode: "form",
      requestedSchema: {
        properties: { approve: { type: "boolean" } },
        required: ["approve"],
        type: "object",
      },
    },
  })
  assert.deepEqual(current.trace, ["plan", "mint"])
})

test("reviewed execution accepts exact signed approval without replanning", async () => {
  const current = fixture({
    inputResponses: {
      [CONFIRMATION_KEY]: {
        action: "accept",
        content: { approve: true },
      },
    },
    requestState: REQUEST_STATE,
  })
  const result = await runReviewedToolExecution(current.options)

  assert.deepEqual(result, {
    isError: false,
    result: { status: "completed" },
    summary: "Execution completed",
  })
  assert.deepEqual(current.trace, ["validate-state", "execute", "render:ok"])
})

test("reviewed execution rejects invalid signed state before response handling", async () => {
  const current = fixture({
    inputResponses: {
      [CONFIRMATION_KEY]: {
        action: "accept",
        content: { approve: true },
      },
    },
    requestState: { signed: false },
  })
  const result = await runReviewedToolExecution(current.options)

  assert.deepEqual(result, {
    isError: true,
    result: {
      reason: "Signed state did not match",
      status: "confirmation-invalid",
    },
    summary: "Signed state did not match",
  })
  assert.deepEqual(current.trace, [
    "validate-state",
    "outcome:confirmation-invalid",
    "render:error",
  ])
})

test("reviewed execution distinguishes canceled and declined confirmation", async (context) => {
  for (const action of ["cancel", "decline"] as const) {
    await context.test(action, async () => {
      const current = fixture({
        inputResponses: { [CONFIRMATION_KEY]: { action } },
        requestState: REQUEST_STATE,
      })
      const result = await runReviewedToolExecution(current.options)

      assert.deepEqual(result, {
        isError: false,
        result: {
          reason: action === "cancel"
            ? "Confirmation was canceled"
            : "Confirmation was declined",
          status: "confirmation-declined",
        },
        summary: action === "cancel"
          ? "Confirmation was canceled"
          : "Confirmation was declined",
      })
      assert.deepEqual(current.trace, [
        "validate-state",
        "outcome:confirmation-declined",
        "render:ok",
      ])
    })
  }
})

test("reviewed execution rejects malformed approval and orphan responses", async (context) => {
  await context.test("malformed approval", async () => {
    const current = fixture({
      inputResponses: {
        [CONFIRMATION_KEY]: {
          action: "accept",
          content: { approve: false },
        },
      },
      requestState: REQUEST_STATE,
    })
    const result = await runReviewedToolExecution(current.options)

    assert.equal("isError" in result && result.isError, true)
    assert.deepEqual(current.trace, [
      "validate-state",
      "outcome:confirmation-invalid",
      "render:error",
    ])
  })

  await context.test("orphan response", async () => {
    const current = fixture({
      inputResponses: {
        [CONFIRMATION_KEY]: {
          action: "accept",
          content: { approve: true },
        },
      },
    })
    const result = await runReviewedToolExecution(current.options)

    assert.equal("isError" in result && result.isError, true)
    assert.deepEqual(current.trace, [
      "outcome:confirmation-invalid",
      "render:error",
    ])
    assert.deepEqual(result, {
      isError: true,
      result: {
        reason: "Responses require signed state",
        status: "confirmation-invalid",
      },
      summary: "Responses require signed state",
    })
  })
})

test("reviewed execution rejects a changed fresh plan before minting state", async () => {
  const current = fixture({
    async plan() {
      current.trace.push("plan")
      return { digest: CHANGED_DIGEST, writeRequired: true }
    },
  })
  const result = await runReviewedToolExecution(current.options)

  assert.deepEqual(result, {
    isError: true,
    result: { actualDigest: CHANGED_DIGEST, status: "plan-changed" },
    summary: "The reviewed plan changed",
  })
  assert.deepEqual(current.trace, ["plan", "plan-changed", "render:error"])
})

test("reviewed execution runs a fresh no-op without elicitation or state", async () => {
  const current = fixture({
    async plan() {
      current.trace.push("plan")
      return { digest: PLAN_DIGEST, writeRequired: false }
    },
  })
  const result = await runReviewedToolExecution(current.options)

  assert.deepEqual(result, {
    isError: false,
    result: { status: "completed" },
    summary: "No write completed",
  })
  assert.deepEqual(current.trace, ["plan", "execute", "render:ok"])
})

test("reviewed execution leaves mint and service failures to the outer handler", async (context) => {
  await context.test("mint failure", async () => {
    const failure = new Error("mint failed")
    const current = fixture({
      async mintRequestState() {
        current.trace.push("mint")
        throw failure
      },
    })
    await assert.rejects(
      () => runReviewedToolExecution(current.options),
      failure,
    )
    assert.deepEqual(current.trace, ["plan", "mint"])
  })

  await context.test("execution failure", async () => {
    const failure = new Error("execution failed")
    const current = fixture({
      async execute() {
        current.trace.push("execute")
        throw failure
      },
      inputResponses: {
        [CONFIRMATION_KEY]: {
          action: "accept",
          content: { approve: true },
        },
      },
      requestState: REQUEST_STATE,
    })
    await assert.rejects(
      () => runReviewedToolExecution(current.options),
      failure,
    )
    assert.deepEqual(current.trace, ["validate-state", "execute"])
  })
})
