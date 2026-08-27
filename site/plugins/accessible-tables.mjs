function makeTablesFocusable(node) {
  if (node?.type === "element" && node.tagName === "table") {
    node.properties = { ...node.properties, tabIndex: 0 }
  }
  for (const child of node?.children || []) makeTablesFocusable(child)
}

export default function accessibleTables() {
  return makeTablesFocusable
}
