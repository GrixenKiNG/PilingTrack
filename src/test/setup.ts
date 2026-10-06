import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// R70, находка 4: дефолт @testing-library/dom — asyncUtilTimeout 1000 мс, то есть
// впятеро строже testTimeout витста, и явный таймаут на тест от этого класса
// падений не спасает (сообщение — «Unable to find an element», а не «timed out»).
// Под ночной нагрузкой это оклеветывало чужие правки. 5000 мс совпадает с
// testTimeout: это лимит, а не задержка, поэтому зелёный прогон не удлиняется.
configure({ asyncUtilTimeout: 5000 });
