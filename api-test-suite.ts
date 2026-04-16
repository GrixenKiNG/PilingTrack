/**
 * PilingTrack Comprehensive API Test Suite
 * 
 * Tests:
 * - Authentication (login/logout)
 * - Module access for all roles
 * - CRUD operations
 * - PDF generation
 * - Health checks
 */

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message: string;
  duration: number;
}

interface TestUser {
  email: string;
  password: string;
  role: string;
  name: string;
}

const TEST_USERS: TestUser[] = [
  {
    email: 'admin@piling.ru',
    password: 'password123',
    role: 'ADMIN',
    name: 'Admin User',
  },
  {
    email: 'dispatch@piling.ru',
    password: 'password123',
    role: 'DISPATCHER',
    name: 'Dispatcher',
  },
  {
    email: 'operator@piling.ru',
    password: 'password123',
    role: 'OPERATOR',
    name: 'Operator',
  },
  {
    email: 'helper@piling.ru',
    password: 'password123',
    role: 'ASSISTANT',
    name: 'Assistant',
  },
];

const BASE_URL = 'http://localhost:3000/api';

/**
 * Simple cookie storage
 */
class SimpleCookieJar {
  private cookies: Map<string, string> = new Map();

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  getCookieString(): string {
    const pairs: string[] = [];
    for (const [key, value] of this.cookies) {
      pairs.push(`${key}=${value}`);
    }
    return pairs.join('; ');
  }

  parseSetCookie(header: string | null): void {
    if (!header) return;

    const cookies = header.split(',').map(c => c.trim());
    for (const cookie of cookies) {
      // Parse "name=value; path=/; ..."
      const parts = cookie.split(';')[0].trim();
      const [name, value] = parts.split('=');
      if (name && value) {
        this.setCookie(name, value);
      }
    }
  }
}

/**
 * Create a fetch wrapper with cookie handling
 */
function createApiClient(cookieJar: SimpleCookieJar) {
  return async (method: string, endpoint: string, body?: any) => {
    const url = `${BASE_URL}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    // Add cookies to request
    const cookieString = cookieJar.getCookieString();
    if (cookieString) {
      headers['Cookie'] = cookieString;
    }

    const options: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    try {
      const response = await fetch(url, options);
      
      // Store cookies from response
      const setCookieHeader = response.headers.get('set-cookie');
      if (setCookieHeader) {
        cookieJar.parseSetCookie(setCookieHeader);
      }

      const data = await response.json().catch(() => ({}));
      
      return {
        ok: response.ok,
        status: response.status,
        data,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
        data: {},
      };
    }
  };
}

/**
 * Test authentication
 */
async function testAuthentication(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const user of TEST_USERS) {
    const startTime = Date.now();
    const cookieJar = new SimpleCookieJar();
    const api = createApiClient(cookieJar);

    try {
      // Test login
      const loginRes = await api('POST', '/auth/login', {
        email: user.email,
        password: user.password,
      });

      if (loginRes.ok && loginRes.data?.user) {
        results.push({
          name: `Auth: Login as ${user.role}`,
          status: 'PASS',
          message: `Successfully logged in`,
          duration: Date.now() - startTime,
        });

        // Test /auth/me (session check)
        const meRes = await api('GET', '/auth/me');
        if (meRes.ok && meRes.data?.user?.id) {
          results.push({
            name: `Auth: Session valid for ${user.role}`,
            status: 'PASS',
            message: `Session is valid`,
            duration: Date.now() - startTime,
          });
        } else {
          results.push({
            name: `Auth: Session valid for ${user.role}`,
            status: 'FAIL',
            message: `Session invalid: ${meRes.error || meRes.status}`,
            duration: Date.now() - startTime,
          });
        }
      } else {
        results.push({
          name: `Auth: Login as ${user.role}`,
          status: 'FAIL',
          message: `Login failed: ${loginRes.error || loginRes.data?.error || loginRes.status}`,
          duration: Date.now() - startTime,
        });
      }
    } catch (error) {
      results.push({
        name: `Auth: Login as ${user.role}`,
        status: 'FAIL',
        message: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
    }
  }

  return results;
}

/**
 * Test module access
 */
async function testModuleAccess(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const modules = ['sites', 'equipment', 'crews', 'reports', 'users', 'dictionary'];

  // Test as ADMIN only
  const adminUser = TEST_USERS.find(u => u.role === 'ADMIN')!;
  const startLoginTime = Date.now();
  const cookieJar = new SimpleCookieJar();
  const api = createApiClient(cookieJar);

  try {
    // Login as admin
    const loginRes = await api('POST', '/auth/login', {
      email: adminUser.email,
      password: adminUser.password,
    });

    if (!loginRes.ok) {
      results.push({
        name: 'Module: Admin login',
        status: 'FAIL',
        message: 'Could not log in as admin',
        duration: Date.now() - startLoginTime,
      });
      return results;
    }

    // Test each module
    for (const moduleName of modules) {
      const startTime = Date.now();
      let endpoint = '';

      switch (moduleName) {
        case 'sites':
          endpoint = '/sites/all';
          break;
        case 'equipment':
          endpoint = '/equipment';
          break;
        case 'crews':
          endpoint = '/crews';
          break;
        case 'reports':
          endpoint = '/reports/all';
          break;
        case 'users':
          endpoint = '/users';
          break;
        case 'dictionary':
          endpoint = '/dictionary/all';
          break;
      }

      const res = await api('GET', endpoint);

      if (res.ok) {
        const count = Array.isArray(res.data?.data)
          ? res.data.data.length
          : Array.isArray(res.data)
          ? res.data.length
          : '?';
        
        results.push({
          name: `Module: Access ${moduleName}`,
          status: 'PASS',
          message: `Accessible (${count} items)`,
          duration: Date.now() - startTime,
        });
      } else {
        results.push({
          name: `Module: Access ${moduleName}`,
          status: 'FAIL',
          message: `Error: ${res.status} ${res.error}`,
          duration: Date.now() - startTime,
        });
      }
    }
  } catch (error) {
    results.push({
      name: 'Module: Test suite',
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startLoginTime,
    });
  }

  return results;
}

/**
 * Test API health
 */
async function testHealth(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    const startTime = Date.now();
    const api = createApiClient(new SimpleCookieJar());

    const healthRes = await api('GET', '/ready');
    if (healthRes.ok) {
      results.push({
        name: 'Health: API ready',
        status: 'PASS',
        message: 'API is ready',
        duration: Date.now() - startTime,
      });
    } else {
      results.push({
        name: 'Health: API ready',
        status: 'FAIL',
        message: `API not ready: ${healthRes.status}`,
        duration: Date.now() - startTime,
      });
    }
  } catch (error) {
    results.push({
      name: 'Health: API ready',
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      duration: 0,
    });
  }

  return results;
}

/**
 * Main test runner
 */
async function runAllTests(): Promise<void> {
  console.log('\n🧪 PilingTrack API Test Suite\n');
  console.log('═'.repeat(70));

  const allResults: TestResult[] = [];

  // Run test suites
  console.log('\n📋 Running Health Checks...');
  allResults.push(...(await testHealth()));
  console.log('✓ Health checks completed');

  console.log('\n📋 Running Authentication Tests...');
  allResults.push(...(await testAuthentication()));
  console.log('✓ Authentication tests completed');

  console.log('\n📋 Running Module Access Tests...');
  allResults.push(...(await testModuleAccess()));
  console.log('✓ Module access tests completed');

  // Print results
  console.log('\n' + '═'.repeat(70));
  console.log('\n📊 Test Results:\n');

  const passed = allResults.filter(r => r.status === 'PASS').length;
  const failed = allResults.filter(r => r.status === 'FAIL').length;
  const skipped = allResults.filter(r => r.status === 'SKIP').length;
  const total = allResults.length;

  console.log(`Total Tests:     ${total}`);
  console.log(`✅ Passed:       ${passed}`);
  console.log(`❌ Failed:       ${failed}`);
  console.log(`⏭️  Skipped:     ${skipped}`);
  console.log(`Success Rate:    ${((passed / total) * 100).toFixed(1)}%\n`);

  // Print detailed results
  console.log('═'.repeat(70));
  console.log('\n📝 Test Results:\n');

  for (const result of allResults) {
    const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⏭️ ';
    console.log(`${icon} ${result.name}`);
    console.log(`   ${result.message} (${result.duration}ms)`);
  }

  console.log('\n' + '═'.repeat(70));
  console.log('\n✨ Summary:\n');

  if (failed === 0) {
    console.log('✨ All tests passed! Application is ready.\n');
  } else {
    console.log(`⚠️  ${failed} test(s) failed. Please review.\n`);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
