import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { readSessionToken, SESSION_COOKIE_NAME } from '../session-token';

describe('readSessionToken', () => {
  it('reads the token from the session cookie', () => {
    const request = new NextRequest('http://localhost');
    request.cookies.set(SESSION_COOKIE_NAME, 'cookie-token');

    expect(readSessionToken(request)).toBe('cookie-token');
  });

  it('reads the token from a Bearer Authorization header', () => {
    const request = new NextRequest('http://localhost', {
      headers: { Authorization: 'Bearer header-token' },
    });

    expect(readSessionToken(request)).toBe('header-token');
  });

  it('prefers the cookie over the header', () => {
    const request = new NextRequest('http://localhost', {
      headers: { Authorization: 'Bearer header-token' },
    });
    request.cookies.set(SESSION_COOKIE_NAME, 'cookie-token');

    expect(readSessionToken(request)).toBe('cookie-token');
  });

  it('ignores a non-Bearer Authorization header', () => {
    const request = new NextRequest('http://localhost', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });

    expect(readSessionToken(request)).toBeNull();
  });

  it('returns null when no token is present', () => {
    expect(readSessionToken(new NextRequest('http://localhost'))).toBeNull();
  });

  it('keeps the cookie name stable (clients and Caddy rely on it)', () => {
    expect(SESSION_COOKIE_NAME).toBe('pt-session');
  });
});
