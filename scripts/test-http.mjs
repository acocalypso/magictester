// Retry only explicit 429 responses: these requests were rejected before mutation.
export async function rateLimitedFetch(url, init) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt === 4) return response;
    const delay = Math.min(
      60000,
      Math.max(1000, Number(response.headers.get("retry-after") || 1) * 1000),
    );
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
