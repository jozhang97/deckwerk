/** Only web navigation is accepted by the in-app browser. */
export function websiteUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new Error('Enter a website address.');
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP or HTTPS website address without embedded credentials.');
  }
  return url.href;
}

export interface WebsiteState {
  url: string;
  back: boolean;
  forward: boolean;
  loading: boolean;
  error: string;
}
