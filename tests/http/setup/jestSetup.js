"use strict";

// Real network calls against a real server can be slower than Jest's 5s
// default, especially for DB-backed actions.
jest.setTimeout(20000);
