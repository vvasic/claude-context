import { FileSynchronizer } from './synchronizer';

// We need to test the private methods, so we'll create a test subclass
class TestFileSynchronizer extends FileSynchronizer {
    public testShouldIgnore(relativePath: string, isDirectory: boolean = false): boolean {
        return (this as any).shouldIgnore(relativePath, isDirectory);
    }
}

describe('FileSynchronizer - Pattern Matching', () => {
    let synchronizer: TestFileSynchronizer;

    describe('Gitignore-style patterns', () => {

        describe('Root-relative patterns (leading /)', () => {
            beforeEach(() => {
                synchronizer = new TestFileSynchronizer('/test', ['/public/app', '/public/js', '/.tmp/']);
            });

            test('should ignore /public/app directory', () => {
                expect(synchronizer.testShouldIgnore('public/app', true)).toBe(true);
            });

            test('should ignore files inside /public/app', () => {
                expect(synchronizer.testShouldIgnore('public/app/bundle.js', false)).toBe(true);
            });

            test('should ignore nested files inside /public/app', () => {
                expect(synchronizer.testShouldIgnore('public/app/chunks/vendor.js', false)).toBe(true);
            });

            test('should NOT ignore public/app in subdirectory', () => {
                expect(synchronizer.testShouldIgnore('src/public/app', true)).toBe(false);
            });

            test('should ignore /public/js directory', () => {
                expect(synchronizer.testShouldIgnore('public/js', true)).toBe(true);
            });

            test('should ignore files inside /public/js', () => {
                expect(synchronizer.testShouldIgnore('public/js/main.js', false)).toBe(true);
            });

            test('should ignore /.tmp/ directory (with trailing slash)', () => {
                expect(synchronizer.testShouldIgnore('.tmp', true)).toBe(true);
            });

            test('should ignore files inside /.tmp/', () => {
                expect(synchronizer.testShouldIgnore('.tmp/cache/file.txt', false)).toBe(true);
            });
        });

        describe('Directory patterns (trailing /)', () => {
            beforeEach(() => {
                synchronizer = new TestFileSynchronizer('/test', ['node_modules/', 'dist/', '.cache/']);
            });

            test('should ignore node_modules directory', () => {
                expect(synchronizer.testShouldIgnore('node_modules', true)).toBe(true);
            });

            test('should ignore files inside node_modules', () => {
                expect(synchronizer.testShouldIgnore('node_modules/lodash/index.js', false)).toBe(true);
            });

            test('should ignore nested node_modules', () => {
                expect(synchronizer.testShouldIgnore('packages/core/node_modules', true)).toBe(true);
            });

            test('should ignore dist directory', () => {
                expect(synchronizer.testShouldIgnore('dist', true)).toBe(true);
            });

            test('should ignore files inside dist', () => {
                expect(synchronizer.testShouldIgnore('dist/index.js', false)).toBe(true);
            });
        });

        describe('Glob patterns with **', () => {
            beforeEach(() => {
                synchronizer = new TestFileSynchronizer('/test', ['**/*.log', 'build/**', '.next/**']);
            });

            test('should ignore .log files anywhere', () => {
                expect(synchronizer.testShouldIgnore('error.log', false)).toBe(true);
                expect(synchronizer.testShouldIgnore('logs/error.log', false)).toBe(true);
                expect(synchronizer.testShouldIgnore('deep/nested/path/debug.log', false)).toBe(true);
            });

            test('should ignore everything in build/**', () => {
                expect(synchronizer.testShouldIgnore('build', true)).toBe(true);
                expect(synchronizer.testShouldIgnore('build/index.js', false)).toBe(true);
                expect(synchronizer.testShouldIgnore('build/assets/style.css', false)).toBe(true);
            });

            test('should ignore .next directory and contents', () => {
                expect(synchronizer.testShouldIgnore('.next', true)).toBe(true);
                expect(synchronizer.testShouldIgnore('.next/cache', true)).toBe(true);
                expect(synchronizer.testShouldIgnore('.next/static/chunks/main.js', false)).toBe(true);
            });
        });

        describe('Webpack HMR patterns', () => {
            beforeEach(() => {
                synchronizer = new TestFileSynchronizer('/test', [
                    '*.hot-update.js',
                    '*.hot-update.json',
                    '*.hot-update.js.map'
                ]);
            });

            test('should ignore HMR JavaScript files', () => {
                expect(synchronizer.testShouldIgnore('main.abc123.hot-update.js', false)).toBe(true);
            });

            test('should ignore HMR manifest files', () => {
                expect(synchronizer.testShouldIgnore('abc123.hot-update.json', false)).toBe(true);
            });

            test('should ignore HMR source maps', () => {
                expect(synchronizer.testShouldIgnore('main.abc123.hot-update.js.map', false)).toBe(true);
            });

            test('should ignore HMR files in subdirectories', () => {
                expect(synchronizer.testShouldIgnore('public/js/main.hot-update.js', false)).toBe(true);
            });
        });

        describe('Simple filename patterns (no /)', () => {
            beforeEach(() => {
                synchronizer = new TestFileSynchronizer('/test', ['*.min.js', '*.bundle.css', '.env']);
            });

            test('should ignore minified JS anywhere', () => {
                expect(synchronizer.testShouldIgnore('app.min.js', false)).toBe(true);
                expect(synchronizer.testShouldIgnore('dist/vendor.min.js', false)).toBe(true);
            });

            test('should ignore bundle CSS anywhere', () => {
                expect(synchronizer.testShouldIgnore('styles.bundle.css', false)).toBe(true);
                expect(synchronizer.testShouldIgnore('public/css/main.bundle.css', false)).toBe(true);
            });

            test('should ignore .env file', () => {
                expect(synchronizer.testShouldIgnore('.env', false)).toBe(true);
            });
        });

        describe('Hidden files (always ignored)', () => {
            beforeEach(() => {
                synchronizer = new TestFileSynchronizer('/test', []);
            });

            test('should always ignore .git directory', () => {
                expect(synchronizer.testShouldIgnore('.git', true)).toBe(true);
                expect(synchronizer.testShouldIgnore('.git/config', false)).toBe(true);
            });

            test('should always ignore hidden files', () => {
                expect(synchronizer.testShouldIgnore('.gitignore', false)).toBe(true);
                expect(synchronizer.testShouldIgnore('.eslintrc', false)).toBe(true);
            });

            test('should always ignore paths containing hidden directories', () => {
                expect(synchronizer.testShouldIgnore('.cache/files/data.json', false)).toBe(true);
            });
        });

        describe('Real-world walls.io patterns', () => {
            beforeEach(() => {
                // Patterns from walls.io .gitignore
                synchronizer = new TestFileSynchronizer('/test', [
                    '/.tmp/',
                    '/public/app',
                    '/public/carousel',
                    '/public/css',
                    '/public/js',
                    '/public/messages',
                    '/node_modules',
                    '*.log'
                ]);
            });

            test('should ignore .tmp directory and contents', () => {
                expect(synchronizer.testShouldIgnore('.tmp', true)).toBe(true);
                expect(synchronizer.testShouldIgnore('.tmp/yarn/cache', true)).toBe(true);
                expect(synchronizer.testShouldIgnore('.tmp/lint-js/output.txt', false)).toBe(true);
            });

            test('should ignore public/app and contents', () => {
                expect(synchronizer.testShouldIgnore('public/app', true)).toBe(true);
                expect(synchronizer.testShouldIgnore('public/app/app.js', false)).toBe(true);
                expect(synchronizer.testShouldIgnore('public/app/chunk-vendor.abc123.js', false)).toBe(true);
            });

            test('should ignore public/js and contents', () => {
                expect(synchronizer.testShouldIgnore('public/js', true)).toBe(true);
                expect(synchronizer.testShouldIgnore('public/js/main.js', false)).toBe(true);
                expect(synchronizer.testShouldIgnore('public/js/wall-grid.js', false)).toBe(true);
            });

            test('should ignore public/css and contents', () => {
                expect(synchronizer.testShouldIgnore('public/css', true)).toBe(true);
                expect(synchronizer.testShouldIgnore('public/css/main.css', false)).toBe(true);
            });

            test('should ignore log files anywhere', () => {
                expect(synchronizer.testShouldIgnore('error.log', false)).toBe(true);
                expect(synchronizer.testShouldIgnore('htdocs/app/tmp/logs/debug.log', false)).toBe(true);
            });

            test('should NOT ignore source files', () => {
                expect(synchronizer.testShouldIgnore('src/index.ts', false)).toBe(false);
                expect(synchronizer.testShouldIgnore('assets/js/main.js', false)).toBe(false);
                expect(synchronizer.testShouldIgnore('react-app/backend.jsx', false)).toBe(false);
            });
        });
    });
});
