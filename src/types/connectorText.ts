export type ConnectorTextBlock = {
  type: 'connector_text'
  connector_text: string
}

export type ConnectorTextDelta = {
  type: 'connector_text_delta'
  connector_text: string
}

export function isConnectorTextBlock(
  value: unknown,
): value is ConnectorTextBlock {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    (value as { type?: unknown }).type === 'connector_text' &&
    'connector_text' in value &&
    typeof (value as { connector_text?: unknown }).connector_text === 'string'
  )
}
