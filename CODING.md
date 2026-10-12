# TypeScript Coding Conventions

These rules apply to general TypeScript projects across the company. They are
not tied to a particular workspace or product.

Apply them to TypeScript code being changed, not as a reason to rewrite unrelated
code. Respect the consuming project's `AGENTS.md`, supported runtime, and tool
configuration. Other profiles apply only when explicitly selected; when composed,
framework-specific rules specialize general rules within that framework's scope.

## General rules

- Use TypeScript where the project uses it; do not migrate other languages as a side effect.
- Write comments and documentation in English.
- Prefer specific types for known data and `unknown` for untrusted data until validated. Type assertions and interfaces do not perform runtime validation. Keep unavoidable `any` localized to the boundary that requires it.
- Follow the project's Prettier configuration. The company default is `@opendreamnet/prettier-config` with `@prettier/plugin-oxc`, single quotes, and no semicolons; do not install or change formatting tools merely to apply this profile.
- Prioritize dependencies already installed in the relevant `package.json`.
- Add a dependency only when existing dependencies and platform APIs are insufficient. Check runtime compatibility, maintenance, and known security advisories using available evidence; a recent release alone does not establish safety. Explain the addition and any checks that could not be completed.

## Repository analysis workflow

- Prefer indexed or semantic discovery when available before broad file reading; ordinary file and text search is sufficient otherwise.
- Use this default workflow: discover files, search symbols and usages, then read only relevant sections.
- Use exact search (`grep`) when the identifier or string is already known.
- Before refactors, renames, or deletions, check affected usages, references, callers, and dependents.
- Ground architectural conclusions in concrete evidence such as file paths, symbols, and callers.
- When external information is needed, prefer official documentation and source code matching the installed version. Use available search or documentation tools; do not assume a specific tool or service exists.

## Validation workflow

- Inspect the relevant `package.json`, lockfile, and TypeScript configuration before choosing validation commands. Use the project's package manager and locally managed tools.
- Run the available type-check, lint, and formatting checks for the affected package. Use `typecheck` and `prettier:check` when those scripts exist; otherwise use the configured equivalents.
- Run `tsc` with the appropriate project configuration, not with a list of changed source files, which bypasses `tsconfig.json`. Use the framework's checker when required, such as one that also checks Vue templates.
- Do not use `prettier:fix`; it is reserved for developers.
- Avoid `build` scripts unless a build is genuinely required, because they can take a significant amount of time.
- Resolve tools from the package or workspace that owns the code; do not assume a particular installation layout or silently download missing tools. Report checks not run and the reason.
- Add or update tests for changed behavior and run the relevant suite, including failure paths. Type checking and formatting are not substitutes for behavioral tests.

## Naming conventions

Use intent-based function names:

- `setX(value)`: set an explicit value from arguments.
- `updateX(value)`: update an existing internal value.
- `getX()`: retrieve from local state, cache, database, or another internal source.
- `fetchX()`: retrieve from an external service or API.
- `refreshX(...)`: recompute or reload existing data rather than accept its replacement; identifiers or refresh options are allowed.

Examples:

- `setConfig(value)` explicitly replaces a configuration value.
- `updateUserAge(value)` changes an existing user value.
- `getUserSettings()` reads settings from local state, a cache, or a database.
- `fetchApiData()` retrieves data from an external service.
- `refreshUserCache()` refreshes local cached data without receiving the new value as an argument.

## TypeScript and class design

Apply these rules to `**/*.{ts,tsx,cts,mts}`.

### Imports and module structure

- Prefer top-level static imports. Use dynamic imports for a concrete need such as lazy loading, code splitting, optional dependencies, or a runtime boundary. Follow the project's module system; investigate circular dependencies rather than hiding them by default.

Avoid:

```ts
async function loadParser() {
  const { parse } = await import('./parser')

  return parse
}
```

Prefer:

```ts
import { parse } from './parser'

async function loadParser() {
  return parse
}
```

### Null and guard style

- Use `value != null` to exclude both `null` and `undefined` when the lint configuration allows it; otherwise use both strict checks. Preserve `value !== undefined` when `null` is meaningful.
- Distinguish absence from falsiness: `0`, `false`, and `''` may be valid values. Use early returns to reduce nesting, not to mechanically replace clear optional chaining.

When a property is required but may legitimately be falsy, use a nullish guard:

```ts
if (value == null || value.property == null) {
  return
}

continueWithValue(value)
```

Use a truthiness check only when rejecting falsy property values is intentional:

```ts
if (value?.property) {
  continueWithValue(value)
}
```

### Modularization and dependency flow

- Do not implement major features directly in a single orchestrator or root module.
- Keep orchestrators thin; delegate responsibilities to dedicated modules or services.
- Wire long-lived dependencies at the composition root or through the framework's container. Pass dependencies explicitly; do not introduce a container or class hierarchy for a simple function.
- Store orchestrator-owned module instances as private fields when applicable.
- Do not use ad-hoc getter callbacks such as `getX: () => X` as the default dependency flow.
- If data is lifecycle-stable, inject readonly values.
- If data is dynamic, inject a narrow service interface or the reactive/provider abstraction established by the framework. A callback is appropriate when deferred evaluation is part of the contract.

Keep the root focused on wiring and coordination:

```ts
class FeatureOrchestrator {
  readonly #featureModule: FeatureModule
  readonly #secondaryModule: SecondaryModule

  constructor() {
    this.#featureModule = new FeatureModule()

    this.#secondaryModule = new SecondaryModule({
      featureModule: this.#featureModule,
    })
  }
}
```

The modules should contain their own responsibilities rather than moving the
feature implementation into `FeatureOrchestrator`.

For a stable value, prefer an injected readonly value:

```ts
interface TranslatorOptions {
  readonly sourceLang: string
}

class Translator {
  readonly #sourceLang: string

  constructor(options: TranslatorOptions) {
    this.#sourceLang = options.sourceLang
  }
}
```

Avoid replacing that value with an ad-hoc callback such as
`getSourceLang: () => string`. If the value is dynamic, inject the responsible
module or a narrow service interface, unless an established provider contract
requires a callback. TypeScript `readonly` prevents reassignment through that
reference; it does not freeze nested objects at runtime.

## Reuse and duplication

- Extract repeated logic when it represents the same responsibility and should change together. Do not create helpers for hypothetical reuse or merge similar-looking code with different domain rules.
- If the logic only applies to one class or system, keep the helper in that class or system, usually as a private method. Do not extract domain-specific logic into a generic utility merely to avoid a longer class.
- Before adding a helper, determine whether it is an independent function or part of a project-specific domain workflow.

### Function location

- Keep single-use helpers near their callers. Place shared standalone functions in focused modules following the project's structure, using `utils` only for genuinely cross-cutting logic.
- Keep business workflows in domain modules or services, whether implemented as functions or classes; do not move them into generic utilities.

### Independent functions

- Prefer a module-level function for straightforward stateless logic. Introduce a class when shared state, lifecycle, or a domain contract justifies it.
- An independent function may depend on a project-specific class, such as `User`, when its logic is abstract, cross-cutting, or belongs to another concern rather than to the class itself.
- This is especially appropriate when the function adapts a local class to an external system, applies an application-wide policy, or is reused across multiple parts of the project.
- Do not force abstract or integration-specific logic into a domain class merely because the function receives an instance of that class.
- Behavior that directly describes an entity's intrinsic state or behavior, such as `displayName()` or `isActive()`, belongs on the class and should remain a class method.
- Prefer a class when the behavior represents an operation owned by the entity, or when multiple operations share complex state or lifecycle management.
- Export reusable functions directly when callers need them; keep file-local helpers unexported. Use descriptive names and the selected framework's naming conventions rather than adding a `use` prefix to every function.
- Keep independent function signatures to a maximum of four parameters. When more data is required, accept one options object with a corresponding interface instead of adding more positional parameters.
- Prefer optional parameters with sensible default values when the operation has a meaningful default; keep parameters required when the operation cannot be correct without them.
- When an independent function interacts with an external library, use the library's exported types for its parameters whenever they are available instead of recreating equivalent local types.
- Standalone functions may use platform APIs or libraries supported by their callers' runtime. Independence from a framework does not make Node.js APIs such as `fs` or `Buffer` available in browsers; keep server-only dependencies out of client modules.
- Group independent functions by one theme per file instead of creating a catch-all utility file. Keep related functions together in files such as `Array.ts`, `File.ts`, `Image.ts`, or `Str.ts`.

Prefer an independent function when the logic is abstract, reusable, and does not clearly belong to the local class:

```ts
// authorization/subject.ts

/**
 * Build the attributes required by an authorization policy.
 */
export function getAuthorizationSubjectAttributes(
  user: User,
): Record<string, string> {
  return { userId: user.id }
}

/**
 * Resolve the access scope used by authorization rules.
 */
export function getAuthorizationResourceScope(user: User): string {
  return user.id
}
```

These functions depend on `User`, but authorization is an application policy rather than intrinsic user behavior. Keeping it outside the class avoids coupling `User` to a specific authorization mechanism and allows the functions to be reused by route guards, background jobs, and service-level checks.

Another valid example is adapting a domain object to an external integration:

```ts
// analytics/user.ts

/**
 * Build the properties sent to the analytics provider.
 */
export function getAnalyticsUserProperties(user: User): Record<string, string> {
  return {
    userId: user.id,
  }
}

/**
 * Return the identifier expected by the analytics provider.
 */
export function getAnalyticsUserIdentifier(user: User): string {
  return user.id
}
```

The analytics representation belongs to the integration layer, not to `User`. These functions can be reused by event tracking, synchronization jobs, and reporting workflows without adding analytics-specific behavior to the domain class.

When a service owns a specific user and repository across operations, a class can
make that ownership explicit:

```ts
class UserService {
  readonly #user: User

  readonly #repository: UserRepository

  constructor(user: User, repository: UserRepository) {
    this.#user = user
    this.#repository = repository
  }

  displayName(): string {
    return this.#user.displayName
  }

  /**
   * Persist the configured user.
   */
  async save(): Promise<void> {
    await this.#repository.save(this.#user)
  }
}
```

The decision should be based on cohesion, complexity, reuse, and shared state, not only on whether a function receives an instance of a project-specific class.

### Project-coupled reusable functions

- If logic is reusable but depends on a project-specific complex class or system, keep it in a domain subdirectory rather than presenting it as a globally independent helper. The file name should describe the specific theme.
- Keep ORM- and application-dependent logic in the domain or service layer. Choose a function or class based on ownership, shared state, and lifecycle, not merely on the presence of an ORM model parameter.

### Class extensibility

- Use ECMAScript `#` private fields and methods by default when compatible with the runtime and framework. They enforce runtime privacy and are not interchangeable with TypeScript `private` when proxies, decorators, or framework reflection access members.
- Promote members to `protected` only for intentional, documented extension points with a real subclass use case.
- Keep the public workflow stable and expose minimal protected hooks when using a template-method design.
- Prefer composition or strategy when only one behavior varies.
- Do not expose mutable internal state to subclasses unless there is a clear, documented need.

Good: private implementation with a documented protected hook:

```ts
abstract class BaseTask {
  #isRunning = false

  public async run(): Promise<void> {
    if (this.#isRunning) {
      throw new Error('Task is already running')
    }

    this.#isRunning = true

    try {
      await this.beforeRun()
    } finally {
      this.#isRunning = false
    }
  }

  /**
   * Allows subclasses to prepare the task without changing the main workflow.
   */
  protected async beforeRun(): Promise<void> {
    return
  }
}
```

Avoid exposing every implementation detail as `protected`:

```ts
class Task {
  protected isRunning = false
  protected config = {}

  protected setRunning(value: boolean): void {
    this.isRunning = value
  }
}
```

When only one behavior varies, prefer composition or a strategy interface:

```ts
interface Formatter {
  format(value: string): string
}

class MessageService {
  readonly #formatter: Formatter

  constructor(formatter: Formatter) {
    this.#formatter = formatter
  }
}
```

### Function and type placement

- Keep small local `type` and `interface` declarations in the same file near their usage.
- Place local declarations before the main class or functions they support.
- Extract contracts to focused shared modules when they have independent consumers or make the implementation difficult to navigate. Property count alone is not a reason to create a file.
- Do not extract a small file-scoped contract merely because another module imports the implementation that contains it.

Preferred extraction pattern: use a dedicated file such as `types/engine.ts` for a
large or shared engine contract.

## General code-writing style

These conventions describe general writing habits.

### Visual density and blank lines

- Group statements by purpose and separate logical phases with one blank line. Do not split cohesive code solely to satisfy a line count or a change from `const` to `let`.
- Treat multiline expressions and literals as logical units. Add surrounding blank lines when they separate distinct phases, not automatically around every multiline expression.
- Put one blank line between the import section and the first declaration.
- Do not add padding immediately after an opening brace or immediately before a closing brace. A blank line should communicate a change of intent, not decorate a block.
- In a method with several guards, group related checks together and separate groups with one blank line. Leave a blank line before the successful fall-through return when it improves readability.
- Separate phases inside longer methods with a blank line; add a short comment only when it explains intent not already clear from the code.
- Separate meaningful sections of long arrays and object literals with a blank line. Keep closely related properties together.
- Use an extra scoped block only when it gives a logical phase its own local variables or prevents a name collision; do not use blocks only to add visual spacing.

For example, keep a multiline declaration such as `salaryResolution` in its own
group rather than placing it directly after another declaration group:

```ts
const validation = validatePayrollInput(input)
const errors = [...validation.errors]
const warnings = [...validation.warnings]

const salaryResolution = resolveSalaryHistory(
  input.salaryHistory,
  input.employee.id,
  input.period.startsOn,
  input.period.endsOn,
)

const incident = input.incidents[0]
const paidDays = incident?.paidDays ?? String(input.period.days)
const scale = Math.max(4, input.rounding.scale)
const salary = salaryResolution.record

let line: PayrollLineResult | null = null
```

### Declarations and expressions

- Use `import type` for dependencies used only as types; retain runtime imports when decorators or framework metadata require values. Preserve existing import style instead of introducing artificial groups or unrelated reordering.
- Use `const` by default and `let` only when a value is reassigned. Destructure an object close to the point where its values are used rather than destructuring everything at the start of a long method.
- Define larger shared contracts separately and give external data a named shape when its structure is known.
- Prefer direct expressions and small helpers over deeply nested temporary variables. A simple getter or mapping helper can use an inferred return type; explicit return types are useful at public, abstract, or important data boundaries.
- Keep object and array literals readable. When an item has nested data, put each property on its own line and let Prettier decide continuation indentation.
- For long method chains, place each meaningful call on its own continuation line. Do not manually align whitespace or compress a nested payload just to reduce line count.

### Control flow

- Use braces for conditional and loop bodies. Scope `switch` cases with braces when they declare lexical bindings. End non-fall-through cases with `break`, `return`, or `throw`; document intentional fall-through.
- Keep one logical action per conditional branch. When several branches perform the same kind of operation, make the distinction between them visible instead of hiding it in a dense expression.
- Await or return promises for asynchronous side effects so callers can observe completion and failure. Use `void` only for intentionally detached work with explicit error handling and an appropriate lifecycle; `void` alone does not handle a rejection.
- Validate and narrow external or persisted data at the boundary. Prefer `unknown`, a specific record shape, or a local interface to unconstrained `any`.

### Classes and methods

- Keep related methods together and separate each member with one blank line. Follow the surrounding class's order; commonly this is state/getters, constructor, public API, and implementation helpers.
- Use explicit visibility when the class exposes an intentional API or extension point. Use `readonly` for state assigned during construction and not replaced afterward.
- Keep methods focused on one responsibility. Move a distinct operation into a helper when it has a meaningful name, is reused, or would otherwise make the main method difficult to scan.
- When overriding inherited behavior, use `override` and preserve the parent contract. Call `super` before subclass initialization when the constructor requires it.
- Keep the main workflow readable from top to bottom: obtain inputs, validate them, transform them, perform side effects, and return the result.

## Commenting standards

### TypeScript comments (`**/*.{ts,tsx,cts,mts}`)

- Keep comments high-signal and maintenance-friendly.
- Document exported contracts and non-obvious behavior with `/** ... */`: include relevant assumptions, side effects, failure modes, or units. Do not add docblocks to obvious callbacks, accessors, or private helpers merely to satisfy coverage.
- Document fields and properties when their meaning or constraints are not clear from their names and types.
- Explain intent, assumptions, side effects, and non-obvious steps; avoid narrating obvious syntax.
- Keep comments updated with code changes and remove stale comments.
- Use multiline docblocks when documentation is needed; keep them concise.
- Prefer short `//` section comments in function bodies and other code when they make logical sections easier to locate quickly, such as `// Validate input`, `// Prepare request`, or `// Charge credits`. Keep the comment immediately above the section it describes and use it for a real conceptual group, not every individual statement.
- Keep inline comments near the relevant lines when a step is non-obvious, algorithmically complex, or coupled to behavior in another module or service.
- Do not add empty docblocks or comments that only restate obvious syntax.

Use a docblock to explain a contract that is not apparent from the signature:

```ts
/**
 * Enhances a prompt after local validation; generation failures propagate to the caller.
 */
async function enhancePrompt(prompt: string): Promise<string> {
  const request = preparePromptRequest(prompt)

  const response = await generatePrompt(request)

  return response.prompt
}
```

Avoid section comments that only repeat the next statement:

```ts
async function enhancePrompt(prompt: string): Promise<string> {
  // Set request
  const request = preparePromptRequest(prompt)

  return request.prompt
}
```

## Conflict resolution and execution

When rules conflict, apply this order:

1. Runtime correctness and the existing architecture.
2. Formatting, linting, and type-checking compliance.
3. Naming, commenting, and other style preferences.

- Prefer minimal, targeted edits.
- Do not change runtime behavior unless required by the task.
- If intent is unclear and logic changes are risky, keep behavior unchanged and state the assumption in the response.
