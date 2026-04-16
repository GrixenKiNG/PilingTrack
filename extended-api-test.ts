/**
 * Extended API Test Suite
 * 
 * Tests:
 * - CRUD operations for different modules
 * - Role-based access control
 * - PDF generation
 * - Equipment creation and management
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
      const parts = cookie.split(';')[0].trim();
      const [name, value] = parts.split('=');
      if (name && value) {
        this.setCookie(name, value);
      }
    }
  }
}

/**
 * Create API client
 */
function createApiClient(cookieJar: SimpleCookieJar) {
  return async (method: string, endpoint: string, body?: any) => {
    const url = `${BASE_URL}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

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
 * Test equipment CRUD
 */
async function testEquipmentCrud(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const admin = TEST_USERS.find(u => u.role === 'ADMIN')!;
  
  const cookieJar = new SimpleCookieJar();
  const api = createApiClient(cookieJar);

  // Login
  const loginStart = Date.now();
  await api('POST', '/auth/login', {
    email: admin.email,
    password: admin.password,
  });
  const duration = Date.now() - loginStart;

  try {
    // Get current equipment count
    const startTime = Date.now();
    const listRes = await api('GET', '/equipment');
    const initialCount = Array.isArray(listRes.data?.data) ? listRes.data.data.length : 0;

    results.push({
      name: 'Equipment: List equipment',
      status: listRes.ok ? 'PASS' : 'FAIL',
      message: `Found ${initialCount} equipment items`,
      duration: Date.now() - startTime,
    });

    // Try to create equipment
    const createStart = Date.now();
    const newEquipment = {
      id: `eq-test-${Date.now()}`,
      name: 'Test Equipment',
      model: 'TEST-001',
      qty: 1,
      description: 'Test equipment for API testing',
      isActive: true,
    };

    const createRes = await api('POST', '/equipment', newEquipment);
    
    if (createRes.ok) {
      results.push({
        name: 'Equipment: Create equipment',
        status: 'PASS',
        message: 'Successfully created test equipment',
        duration: Date.now() - createStart,
      });

      // Try to get the created equipment
      const getStart = Date.now();
      const getRes = await api('GET', `/equipment/${newEquipment.id}`);
      
      results.push({
        name: 'Equipment: Get created equipment',
        status: getRes.ok ? 'PASS' : 'FAIL',
        message: getRes.ok ? 'Successfully retrieved equipment' : `Failed to retrieve: ${getRes.status}`,
        duration: Date.now() - getStart,
      });

      // Try to update equipment
      const updateStart = Date.now();
      const updateRes = await api('PATCH', `/equipment/${newEquipment.id}`, {
        description: 'Updated description',
        qty: 2,
      });

      results.push({
        name: 'Equipment: Update equipment',
        status: updateRes.ok ? 'PASS' : 'FAIL',
        message: updateRes.ok ? 'Successfully updated equipment' : `Failed to update: ${updateRes.status}`,
        duration: Date.now() - updateStart,
      });
    } else {
      results.push({
        name: 'Equipment: Create equipment',
        status: 'FAIL',
        message: `Failed to create: ${createRes.status} ${createRes.error}`,
        duration: Date.now() - createStart,
      });
    }
  } catch (error) {
    results.push({
      name: 'Equipment: Test suite',
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      duration: duration,
    });
  }

  return results;
}

/**
 * Test role-based access
 */
async function testRoleBasedAccess(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const roles = [
    { user: TEST_USERS[0], canCreate: true },     // ADMIN
    { user: TEST_USERS[1], canCreate: false },    // DISPATCHER
    { user: TEST_USERS[2], canCreate: false },    // OPERATOR
    { user: TEST_USERS[3], canCreate: false },    // ASSISTANT
  ];

  for (const { user, canCreate } of roles) {
    const cookieJar = new SimpleCookieJar();
    const api = createApiClient(cookieJar);

    const startTime = Date.now();

    // Login
    await api('POST', '/auth/login', {
      email: user.email,
      password: user.password,
    });

    // Try to create equipment (should fail for non-admin)
    const createRes = await api('POST', '/equipment', {
      id: `eq-role-test-${user.role}`,
      name: 'Role Test Equipment',
      model: 'ROLE-001',
      qty: 1,
      description: 'Test',
      isActive: true,
    });

    const shouldPass = canCreate;
    const actualPass = createRes.ok;

    results.push({
      name: `Role: ${user.role} can create equipment`,
      status: shouldPass === actualPass ? 'PASS' : 'FAIL',
      message: shouldPass 
        ? (actualPass ? 'Allowed to create' : `Denied (${createRes.status})`)
        : (actualPass ? 'Should be denied but succeeded' : `Correctly denied (${createRes.status})`),
      duration: Date.now() - startTime,
    });
  }

  return results;
}

/**
 * Test PDF generation
 */
async function testPdfGeneration(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const admin = TEST_USERS.find(u => u.role === 'ADMIN')!;
  
  const cookieJar = new SimpleCookieJar();
  const api = createApiClient(cookieJar);

  // Login
  await api('POST', '/auth/login', {
    email: admin.email,
    password: admin.password,
  });

  try {
    // Get a report to use for PDF
    const startTime = Date.now();
    const reportsRes = await api('GET', '/reports/all?limit=1');
    
    if (reportsRes.ok && reportsRes.data?.data && reportsRes.data.data.length > 0) {
      const reportId = reportsRes.data.data[0].id;

      // Try to generate PDF
      const pdfStart = Date.now();
      const pdfRes = await api('GET', `/reports/pdf?reportId=${reportId}`);

      results.push({
        name: 'PDF: Generate report PDF',
        status: pdfRes.ok ? 'PASS' : 'FAIL',
        message: pdfRes.ok ? 'Successfully generated PDF' : `Failed: ${pdfRes.status}`,
        duration: Date.now() - pdfStart,
      });
    } else {
      results.push({
        name: 'PDF: Generate report PDF',
        status: 'SKIP',
        message: 'No reports found to test with',
        duration: Date.now() - startTime,
      });
    }
  } catch (error) {
    results.push({
      name: 'PDF: Generate report PDF',
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
  console.log('\n🧪 Extended PilingTrack API Test Suite\n');
  console.log('═'.repeat(70));

  const allResults: TestResult[] = [];

  console.log('\n📋 Running Equipment CRUD Tests...');
  allResults.push(...(await testEquipmentCrud()));
  console.log('✓ Equipment tests completed');

  console.log('\n📋 Running Role-Based Access Tests...');
  allResults.push(...(await testRoleBasedAccess()));
  console.log('✓ Role tests completed');

  console.log('\n📋 Running PDF Generation Tests...');
  allResults.push(...(await testPdfGeneration()));
  console.log('✓ PDF tests completed');

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
    console.log('✨ All tests passed! Application is fully functional.\n');
  } else {
    console.log(`⚠️  ${failed} test(s) failed. Please review.\n`);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
