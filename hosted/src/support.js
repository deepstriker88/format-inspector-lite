// Optional voluntary support. No third-party code, fetch or payment handling.
export function supportLink(username) {
  if(typeof username !== "string" || !/^[A-Za-z0-9_]{1,40}$/.test(username)) return "";
  return '<a href="https://buymeacoffee.com/' + username + '" rel="noreferrer noopener">Buy me a coffee</a>';
}
export function renderSupport(html, username) {
  return html.replaceAll("<!-- optional-support -->", supportLink(username));
}
