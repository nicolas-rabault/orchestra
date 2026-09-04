// The request and the response a handler test hands `createHandler`, in one place. Two suites call
// the monitor's handler in-process — the route suite and the acceptance's served half — and a
// second copy of these eight lines is two things that drift, plus whichever one a third caller
// happens to see first.
//
// Deliberately the smallest thing that satisfies the handler and nothing more: it records what
// `writeHead` and `end` were given, and it delivers a body synchronously. A real `http.IncomingMessage`
// is a stream, and a test that needed one would be testing node rather than this plugin.

// `headersSent` is not decoration: the handler's catch reads it to decide whether a 500 can still
// be written, so a fake that never set it would take the one branch a real response cannot.
export const fakeRes = () => {
  const res = { code: null, body: null, headers: null, headersSent: false };
  res.writeHead = (code, headers) => { res.code = code; res.headers = headers ?? null; res.headersSent = true; };
  res.end = (body) => { res.body = body ?? null; };
  return res;
};

// `on` returns `this` and fires immediately, in the order the handler registers its listeners:
// `data` (only when there is a body), then `end`. `error` is accepted and never fired — no test
// here needs a socket that fails mid-body.
//
// `destroy` is not padding: the handler's 1 MB cap calls it to actually stop the stream, and a fake
// without one turns that cap into a TypeError the test then reads as a plain refusal — measured
// here, it answered 400 "body is not JSON" for a body that was perfectly good JSON and merely too
// large.
export const fakeReq = (method, url, { body = null, headers = {} } = {}) => ({
  method, url, headers,
  destroy() {},
  on(event, fn) {
    if (event === 'data' && body !== null) fn(body);
    if (event === 'end') fn();
    return this;
  },
});
