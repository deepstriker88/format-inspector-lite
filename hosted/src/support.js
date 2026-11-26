// Shared voluntary support and non-authenticated billing portal links.
// No provider API calls, tracking, credentials or entitlement changes.
export function supportLink(username) {
  if(typeof username !== "string" || !/^[A-Za-z0-9_]{1,40}$/.test(username)) return "";
  return '<a href="https://buymeacoffee.com/' + username + '" rel="noreferrer noopener">Buy me a coffee</a>';
}
export function portalLink(url, mode) {
  const hosts={sandbox:"sandbox-customer-portal.paddle.com",live:"customer-portal.paddle.com"};
  if(!Object.hasOwn(hosts,mode)||typeof url!=="string"||url.length>160)return "";
  // Only the seller's public login URL. Never render temporary session tokens.
  const prefix="https://"+hosts[mode]+"/";
  if(!url.startsWith(prefix)||!/^cpl_[a-z0-9]{20,40}\/?$/.test(url.slice(prefix.length)))return "";
  return '<a href="'+url+'" rel="noreferrer noopener">Manage subscription &amp; invoices</a>';
}
export function renderSupport(html, username, portalUrl, mode) {
  return html.replaceAll("<!-- optional-support -->", supportLink(username))
    .replaceAll("<!-- optional-customer-portal -->", portalLink(portalUrl,mode));
}
