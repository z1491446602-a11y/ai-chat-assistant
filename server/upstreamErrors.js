export function parseUpstreamErrorMessage(errorText, fallbackMessage) {
  if (!errorText) {
    return fallbackMessage;
  }

  try {
    const errorJson = JSON.parse(errorText);
    return parseUpstreamErrorMessage(
      errorJson.error?.message || errorJson.message || '',
      fallbackMessage,
    );
  } catch {
    const messageMatch = errorText.match(/"message"\s*:\s*"([^"]+)"/);
    if (messageMatch?.[1]) {
      return messageMatch[1];
    }

    return errorText;
  }
}

export function isRateLimitErrorMessage(errorText) {
  const normalizedText = String(errorText || '').toLowerCase();
  return (
    normalizedText.includes('rate limit')
    || normalizedText.includes('too many requests')
    || normalizedText.includes('limit reached')
    || normalizedText.includes('insufficient balance')
  );
}

export async function getResponseErrorMessage(response, fallbackMessage) {
  try {
    return parseUpstreamErrorMessage(await response.text(), fallbackMessage);
  } catch {
    return fallbackMessage;
  }
}
