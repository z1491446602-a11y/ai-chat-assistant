export async function fetchWithSingleRetry(
  request: () => Promise<Response>,
  userMessage: string,
): Promise<Response> {
  try {
    return await request();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!/fetch failed|failed to fetch|networkerror/i.test(message)) {
      throw error;
    }

    await new Promise(resolve => setTimeout(resolve, 350));

    try {
      return await request();
    } catch (retryError) {
      const retryMessage = retryError instanceof Error ? retryError.message : '';
      if (/fetch failed|failed to fetch|networkerror/i.test(retryMessage)) {
        throw new Error(userMessage);
      }

      throw retryError;
    }
  }
}

export async function readJsonResult(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
