import {
  acceptedContent,
  inputRequired,
  inputResponse,
  type InputRequiredResult,
} from "@modelcontextprotocol/server"
import { z } from "zod"

import {
  requireReviewedPlanDigest,
  resolveSignedReviewedPlanDigest,
} from "./reviewed-plan.js"

const REVIEWED_APPROVAL_RESPONSE_SCHEMA = z.strictObject({
  approve: z.boolean(),
})

type DeclinedConfirmationAction = "cancel" | "decline"
type ReviewedConfirmationStatus =
  | "confirmation-declined"
  | "confirmation-invalid"
type ElicitationRequestedSchema = Parameters<
  typeof inputRequired.elicit
>[0]["requestedSchema"]

export interface ReviewedToolPlan {
  readonly digest: string
  readonly writeRequired: boolean
}

export interface ReviewedToolExecutionOptions<
  Plan extends ReviewedToolPlan,
  Execution extends object,
  Complete,
> {
  readonly confirmation: {
    readonly approvalRequiredReason: string
    readonly declinedReason: (action: DeclinedConfirmationAction) => string
    readonly invalidStateReason: string
    readonly key: string
    readonly message: (plan: Plan) => string
    readonly missingStateReason: string
    readonly requestedSchema: ElicitationRequestedSchema
  }
  readonly execute: (planDigest: string) => Promise<Execution>
  readonly inputResponses: Record<string, unknown> | undefined
  readonly mintRequestState: (
    payload: Readonly<Record<string, unknown>>,
  ) => Promise<string>
  readonly outcome: (
    planDigest: string,
    status: ReviewedConfirmationStatus,
    reason: string,
  ) => object
  readonly plan: () => Promise<Plan>
  readonly planChanged: (plan: Plan, expectedPlanDigest: string) => {
    readonly result: object
    readonly summary: string
  }
  readonly planDigest: string | undefined
  readonly render: (
    result: object,
    summary: string,
    options?: { isError?: boolean },
  ) => Complete
  readonly requestState: unknown
  readonly requestStatePayload: Readonly<Record<string, unknown>>
  readonly summarizeExecution: (result: Execution) => string
  readonly summarizeNoWrite: (result: Execution) => string
  readonly validRequestState: (value: unknown, planDigest: string) => boolean
}

function isDeclinedConfirmationAction(
  action: "accept" | "cancel" | "decline",
): action is DeclinedConfirmationAction {
  return action === "cancel" || action === "decline"
}

function invalidConfirmation<
  Plan extends ReviewedToolPlan,
  Execution extends object,
  Complete,
>(
  options: ReviewedToolExecutionOptions<Plan, Execution, Complete>,
  planDigest: string,
  reason: string,
): Complete {
  const result = options.outcome(planDigest, "confirmation-invalid", reason)
  return options.render(result, reason, { isError: true })
}

export async function runReviewedToolExecution<
  Plan extends ReviewedToolPlan,
  Execution extends object,
  Complete,
>(
  options: ReviewedToolExecutionOptions<Plan, Execution, Complete>,
): Promise<Complete | InputRequiredResult> {
  if (options.requestState !== undefined) {
    const planDigestResolution = resolveSignedReviewedPlanDigest(
      options.requestState,
      options.planDigest,
    )
    const { planDigest } = planDigestResolution
    if (
      !planDigestResolution.matchesSignedState
      || !options.validRequestState(options.requestState, planDigest)
    ) {
      return invalidConfirmation(
        options,
        planDigest,
        options.confirmation.invalidStateReason,
      )
    }
    const response = inputResponse(
      options.inputResponses,
      options.confirmation.key,
    )
    if (
      response.kind === "elicit"
      && isDeclinedConfirmationAction(response.action)
    ) {
      const reason = options.confirmation.declinedReason(response.action)
      const result = options.outcome(
        planDigest,
        "confirmation-declined",
        reason,
      )
      return options.render(result, reason)
    }
    const confirmation = acceptedContent(
      options.inputResponses,
      options.confirmation.key,
      REVIEWED_APPROVAL_RESPONSE_SCHEMA,
    )
    if (confirmation?.approve !== true) {
      return invalidConfirmation(
        options,
        planDigest,
        options.confirmation.approvalRequiredReason,
      )
    }
    const result = await options.execute(planDigest)
    return options.render(result, options.summarizeExecution(result))
  }
  if (options.inputResponses !== undefined) {
    const planDigest = requireReviewedPlanDigest(
      options.planDigest,
      options.confirmation.missingStateReason,
    )
    return invalidConfirmation(
      options,
      planDigest,
      options.confirmation.missingStateReason,
    )
  }

  const plan = await options.plan()
  const expectedPlanDigest = options.planDigest
  if (
    expectedPlanDigest !== undefined
    && plan.digest !== expectedPlanDigest
  ) {
    const changed = options.planChanged(plan, expectedPlanDigest)
    return options.render(changed.result, changed.summary, { isError: true })
  }
  const planDigest = requireReviewedPlanDigest(
    expectedPlanDigest ?? plan.digest,
    "Fresh reviewed plan did not contain a valid digest",
  )
  if (!plan.writeRequired) {
    const result = await options.execute(planDigest)
    return options.render(result, options.summarizeNoWrite(result))
  }
  const signedState = await options.mintRequestState({
    ...options.requestStatePayload,
    planDigest,
  })
  return inputRequired({
    inputRequests: {
      [options.confirmation.key]: inputRequired.elicit({
        message: options.confirmation.message(plan),
        requestedSchema: options.confirmation.requestedSchema,
      }),
    },
    requestState: signedState,
  })
}
