import type { DataCollection } from '@sentry/core';

// Preserve the v10 sendDefaultPii:false baseline in every runtime.
const privateKeys = ['forwarded', '-ip', 'remote-', 'via', '-user'];
const privateHeaders = [...privateKeys, 'authorization', 'cookie', 'set-cookie'];

export const sentryDataCollection: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: privateHeaders },
    response: { deny: privateHeaders },
  },
  httpBodies: [],
  urlQueryParams: { deny: [...privateKeys, 'token', 'password'] },
  databaseQueryData: false,
  genAI: { inputs: false, outputs: false },
  graphQL: { document: false, variables: false },
};
