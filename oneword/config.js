// Public configuration only. Never put API keys or teacher PINs in this file.
// Keep this deployment URL when publishing updates; edit only when changing backends.
// transport.js uses the standard /macros/s/ endpoint for iframe loading, while
// retaining this URL as the storage identity so existing room/player tokens survive.
export const config = {
  gasUrl: 'https://script.google.com/a/macros/mail.qfm.kh.edu.tw/s/AKfycbxADqWGu8UA_WDFWMJpal6HECz4IRgtMjJdnSRuaps757S2Hv3Cy_IP-9c71m-HxxU3zg/exec',
  pollMs: 3500,
};
