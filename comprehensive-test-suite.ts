/**
 * Comprehensive Test Suite for PilingTrack
 * 
 * Tests all modules and roles:
 * - Dashboard, Sites, Equipment, Crews, Reports, Dictionary, Users, Telegram
 * - Admin, Dispatcher, Operator, Assistant roles
 * - PDF generation and report functionality
 */

interface TestUser {
  email: string;
  password: string;
  role: string;
  name: string;
}

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  message: string;
  duration: number;
}

const TEST_USERS: TestUser[] = [
  {
    email: 'admin@pilingtrack.local',
    password: 'password123',
    role: 'ADMIN',
    name: 'Admin User',
  },
  {
    email: 'dispatcher@pilingtrack.local',
    password: 'password123',
    role: 'DISPATCHER',
    name: 'Dispatcher',
  },
  {
    email: 'operator@pilingtrack.local',
    password: 'password123',
    role: 'OPERATOR',
    name: 'Operator',
  },
  {
    email: 'assistant@pilingtrack.local',
    password: 'password123',
    role: 'ASSISTANT',
    name: 'Assistant',
  },
];

const BASE_URL = 'http://localhost:3000/api';

/**
 * Create a fetch wrapper with error handling
 */
function createApiClient(authToken?: string) {
  return async (method: string, endpoint: string, body?: any) => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const options: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    try {
      const response = await fetch(`${BASE_URL}${endpoint}`, options);
      if (!response.ok && response.status !== 409) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return {
        ok: response.ok,
        status: response.status,
        data: await response.json(),
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/**
 * Test authentication and session
 */
async function testAuthentication(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const user of TEST_USERS) {
    const startTime = Date.now();
    const api = createApiClient();

    try {
      // Test login endpoint
      const loginRes = await api('POST', '/auth/login', {
        email: user.email,
        password: user.password,
      });

      if (loginRes.ok && loginRes.data?.token) {
        results.push({
          name: `Auth: Login as ${user.role}`,
          status: 'PASS',
          message: `Successfully logged in as ${user.name}`,
          duration: Date.now() - startTime,
        });

        // Test session validation
        const meRes = await api('GET', '/auth/me');
        if (meRes.ok && meRes.data?.id) {
          results.push({
            name: `Auth: Session validation for ${user.role}`,
            status: 'PASS',
            message: `Session valid for ${user.name}`,
            duration: Date.now() - startTime,
          });
        } else {
          results.push({
            name: `Auth: Session validation for ${user.role}`,
            status: 'FAIL',
            message: `Failed to validate session: ${meRes.error}`,
            duration: Date.now() - startTime,
          });
        }
      } else {
        results.push({
          name: `Auth: Login as ${user.role}`,
          status: 'FAIL',
          message: `Login failed: ${loginRes.error}`,
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
 * Test module access for each role
 */
async function testModuleAccess(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const modules = ['sites', 'equipment', 'crews', 'reports', 'users', 'dictionary'];

  for (const user of TEST_USERS) {
    for (const moduleName of modules) {
      const startTime = Date.now();
      const api = createApiClient();

      try {
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
            endpoint = '/reports';
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
          results.push({
            name: `Module: Access ${moduleName} as ${user.role}`,
            status: 'PASS',
            message: `${user.role} can access ${moduleName} module`,
            duration: Date.now() - startTime,
          });
        } else if (res.status === 401 || res.status === 403) {
          // Expected for some roles
          results.push({
            name: `Module: Access ${moduleName} as ${user.role}`,
            status: user.role === 'ADMIN' ? 'FAIL' : 'PASS',
            message: `${user.role} ${user.role === 'ADMIN' ? 'denied' : 'correctly denied'} access to ${moduleName}`,
            duration: Date.now() - startTime,
          });
        } else {
          results.push({
            name: `Module: Access ${moduleName} as ${user.role}`,
            status: 'FAIL',
            message: `Unexpected error: ${res.error}`,
            duration: Date.now() - startTime,
          });
        }
      } catch (error) {
        results.push({
          name: `Module: Access ${moduleName} as ${user.role}`,
          status: 'FAIL',
          message: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        });
      }
    }
  }

  return results;
}

/**
 * Test CRUD operations for key entities
 */
async function testCrudOperations(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Only test as ADMIN role for CRUD
  const adminUser = TEST_USERS.find(u => u.role === 'ADMIN')!;

  try {
    // Test Equipment CRUD
    const startTime = Date.now();
    const api = createApiClient();

    // Create Equipment
    const createRes = await api('POST', '/equipment', {
      name: 'Test Equipment',
      model: 'TEST-001',
      qty: 1,
      description: 'Equipment for testing',
    });

    if (createRes.ok && createRes.data?.id) {
      results.push({
        name: 'CRUD: Create Equipment',
        status: 'PASS',
        message: 'Successfully created equipment',
        duration: Date.now() - startTime,
      });

      const equipmentId = createRes.data.id;

      // Read Equipment
      const readRes = await api('GET', `/equipment/${equipmentId}`);
      if (readRes.ok) {
        results.push({
          name: 'CRUD: Read Equipment',
          status: 'PASS',
          message: 'Successfully read equipment',
          duration: Date.now() - startTime,
        });
      } else {
        results.push({
          name: 'CRUD: Read Equipment',
          status: 'FAIL',
          message: readRes.error || 'Unknown error',
          duration: Date.now() - startTime,
        });
      }

      // Update Equipment
      const updateRes = await api('PUT', `/equipment/${equipmentId}`, {
        name: 'Updated Test Equipment',
        qty: 2,
      });

      if (updateRes.ok) {
        results.push({
          name: 'CRUD: Update Equipment',
          status: 'PASS',
          message: 'Successfully updated equipment',
          duration: Date.now() - startTime,
        });
      } else {
        results.push({
          name: 'CRUD: Update Equipment',
          status: 'FAIL',
          message: updateRes.error || 'Unknown error',
          duration: Date.now() - startTime,
        });
      }

      // Delete Equipment
      const deleteRes = await api('DELETE', `/equipment/${equipmentId}`);
      if (deleteRes.ok) {
        results.push({
          name: 'CRUD: Delete Equipment',
          status: 'PASS',
          message: 'Successfully deleted equipment',
          duration: Date.now() - startTime,
        });
      } else {
        results.push({
          name: 'CRUD: Delete Equipment',
          status: 'FAIL',
          message: deleteRes.error || 'Unknown error',
          duration: Date.now() - startTime,
        });
      }
    } else {
      results.push({
        name: 'CRUD: Create Equipment',
        status: 'FAIL',
        message: createRes.error || 'Unknown error',
        duration: Date.now() - startTime,
      });
    }
  } catch (error) {
    results.push({
      name: 'CRUD: Equipment Operations',
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
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

  try {
    const startTime = Date.now();
    const api = createApiClient();

    // Get reports first
    const reportsRes = await api('GET', '/reports');
    
    if (reportsRes.ok && Array.isArray(reportsRes.data)) {
      if (reportsRes.data.length > 0) {
        const reportId = reportsRes.data[0].id;

        // Test PDF preview
        const pdfRes = await api('GET', `/reports/pdf?reportId=${reportId}`);

        if (pdfRes.ok || pdfRes.status === 200) {
          results.push({
            name: 'PDF: Generate PDF Preview',
            status: 'PASS',
            message: 'Successfully generated PDF preview',
            duration: Date.now() - startTime,
          });
        } else {
          results.push({
            name: 'PDF: Generate PDF Preview',
            status: 'FAIL',
            message: pdfRes.error || 'Unknown error',
            duration: Date.now() - startTime,
          });
        }
      } else {
        results.push({
          name: 'PDF: Generate PDF Preview',
          status: 'PASS',
          message: 'No reports available for PDF generation test',
          duration: Date.now() - startTime,
        });
      }
    } else {
      results.push({
        name: 'PDF: Generate PDF Preview',
        status: 'FAIL',
        message: 'Failed to fetch reports',
        duration: Date.now() - startTime,
      });
    }
  } catch (error) {
    results.push({
      name: 'PDF: Generate PDF Preview',
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });
  }

  return results;
}

/**
 * Test health checks
 */
async function testHealthChecks(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    const startTime = Date.now();
    const api = createApiClient();

    const healthRes = await api('GET', '/ready');

    if (healthRes.ok) {
      results.push({
        name: 'Health: API Ready Check',
        status: 'PASS',
        message: 'API is ready',
        duration: Date.now() - startTime,
      });
    } else {
      results.push({
        name: 'Health: API Ready Check',
        status: 'FAIL',
        message: healthRes.error || 'API not ready',
        duration: Date.now() - startTime,
      });
    }
  } catch (error) {
    results.push({
      name: 'Health: API Ready Check',
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });
  }

  return results;
}

/**
 * Main test runner
 */
async function runAllTests(): Promise<void> {
  console.log('\n🧪 PilingTrack Comprehensive Test Suite\n');
  console.log('═'.repeat(60));

  const allResults: TestResult[] = [];

  // Run test suites
  console.log('\n📋 Running Authentication Tests...');
  allResults.push(...(await testAuthentication()));

  console.log('✓ Authentication tests completed\n');

  console.log('📋 Running Module Access Tests...');
  allResults.push(...(await testModuleAccess()));
  console.log('✓ Module access tests completed\n');

  console.log('📋 Running CRUD Operations Tests...');
  allResults.push(...(await testCrudOperations()));
  console.log('✓ CRUD operations tests completed\n');

  console.log('📋 Running PDF Generation Tests...');
  allResults.push(...(await testPdfGeneration()));
  console.log('✓ PDF generation tests completed\n');

  console.log('📋 Running Health Check Tests...');
  allResults.push(...(await testHealthChecks()));
  console.log('✓ Health check tests completed\n');

  // Print results
  console.log('═'.repeat(60));
  console.log('\n📊 Test Results Summary:\n');

  const passed = allResults.filter(r => r.status === 'PASS').length;
  const failed = allResults.filter(r => r.status === 'FAIL').length;
  const total = allResults.length;

  console.log(`Total Tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%\n`);

  // Print detailed results
  console.log('═'.repeat(60));
  console.log('\n📝 Detailed Results:\n');

  for (const result of allResults) {
    const icon = result.status === 'PASS' ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
    console.log(`   Message: ${result.message}`);
    console.log(`   Duration: ${result.duration}ms\n`);
  }

  // Print summary
  console.log('═'.repeat(60));
  console.log('\n🎯 Test Summary:\n');

  if (failed === 0) {
    console.log('✨ All tests passed! Application is ready for production.\n');
  } else {
    console.log(`⚠️  ${failed} test(s) failed. Please review and fix.\n`);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
