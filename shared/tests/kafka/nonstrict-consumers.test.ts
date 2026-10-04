import * as path from 'path';
import * as ts from 'typescript';

/**
 * Several consumers do NOT compile shared from dist: their jest configs map
 * `@fuzefront/shared/kafka` straight to `shared/src/kafka/index.ts` and compile
 * it under their own `strict: false` tsconfig (backend, provisioning-service,
 * email-service, billing-service, chat-service). Under strictNullChecks=false
 * zod infers every object property as optional, so code that type-checks here
 * (strict) can fail there. That shipped once (PR #1254: six CI suites red with
 * no failure in this package). This test compiles the kafka barrel the way
 * those consumers do.
 */
describe('shared/src/kafka compiles for non-strict consumers', () => {
  it('has no type errors under strict:false / noImplicitAny:false', () => {
    const entry = path.join(__dirname, '..', '..', 'src', 'kafka', 'index.ts');
    const program = ts.createProgram([entry], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      lib: ['lib.es2020.d.ts'],
      strict: false,
      noImplicitAny: false,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(diagnostics).toEqual([]);
  });
});
