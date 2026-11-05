import { describe, expect, it } from 'vitest';
import { LARAVEL_BASE, check, laravelContract, project, rulesIn } from './helpers.js';

interface Case {
  name: string;
  file: string;
  code: string;
  expected: string[];
  extra?: Record<string, string>;
  contract?: Record<string, unknown>;
}

const php = (ns: string, body: string, uses = '') => `<?php
namespace ${ns};
${uses}
${body}
`;

const C = 'app/Http/Controllers/UserController.php';
const S = 'app/Services/UserService.php';
const R = 'app/Repositories/UserRepository.php';
const SUP = 'app/Support/UserSupport.php';

const FACADE_CONTRACT = {
      layers: {
        controller: ['app/Http/Controllers/**/*.php'],
        support: ['app/Support/**/*.php'],
        service: ['app/Services/**/*.php'],
        repository: ['app/Repositories/**/*.php'],
        model: ['app/Models/**/*.php'],
        shared: ['app/Http/Requests/**/*.php', 'app/DTOs/**/*.php', 'app/Facades/**/*.php'],
      },
    };

const positive: Case[] = [
  {
    name: 'controller imports a model and queries it',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function i() { return User::where("a", 1)->get(); } }', 'use App\\Models\\User;'),
    expected: ['BND001', 'BND002'],
  },
  {
    name: 'controller injects a repository',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function __construct(private UserRepository $r) {} }', 'use App\\Repositories\\UserRepository;'),
    expected: ['BND001'],
  },
  {
    name: 'controller injects a service, skipping support',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function __construct(private UserService $s) {} }', 'use App\\Services\\UserService;'),
    expected: ['BND003'],
  },
  {
    name: 'support injects a repository, skipping service',
    file: SUP,
    code: php('App\\Support', 'class UserSupport { public function __construct(private UserRepository $r) {} }', 'use App\\Repositories\\UserRepository;'),
    expected: ['BND003'],
  },
  {
    name: 'DB::table in a controller',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function i() { return DB::table("users")->get(); } }', 'use Illuminate\\Support\\Facades\\DB;'),
    expected: ['BND002'],
  },
  {
    name: 'DB::select in a service',
    file: S,
    code: php('App\\Services', 'class UserService { public function i() { return DB::select("select 1"); } }', 'use Illuminate\\Support\\Facades\\DB;'),
    expected: ['BND002'],
  },
  {
    name: 'global \\DB alias in a service',
    file: S,
    code: php('App\\Services', 'class UserService { public function i() { return \\DB::table("x")->count(); } }'),
    expected: ['BND002'],
  },
  {
    name: 'fully-qualified model call without a use statement',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function i() { return \\App\\Models\\User::find(1); } }'),
    expected: ['BND001', 'BND002'],
  },
  {
    name: 'aliased model import',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function i() { return Account::query()->get(); } }', 'use App\\Models\\User as Account;'),
    expected: ['BND001', 'BND002'],
  },
  {
    name: 'grouped use statement',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function i() { return User::firstWhere("id", 1); } }', 'use App\\Models\\{User};'),
    expected: ['BND001', 'BND002'],
  },
  {
    name: 'service instantiates a model, skipping the repository',
    file: S,
    code: php('App\\Services', 'class UserService { public function i() { $u = new User(); return $u; } }', 'use App\\Models\\User;'),
    expected: ['BND002', 'BND003'],
  },
  {
    name: 'Eloquent model living outside the model layer is still detected',
    file: S,
    code: php('App\\Services', 'class UserService { public function i() { return Order::where("paid", true)->get(); } }', 'use App\\Legacy\\Order;'),
    extra: {
      'app/Legacy/Order.php': php('App\\Legacy', 'class Order extends Model {}', 'use Illuminate\\Database\\Eloquent\\Model;'),
    },
    expected: ['BND002'],
  },
  {
    name: 'model extending a project base model',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function i() { return Post::latest()->get(); } }', 'use App\\Models\\Post;'),
    extra: {
      'app/Models/BaseModel.php': php('App\\Models', 'abstract class BaseModel extends Model {}', 'use Illuminate\\Database\\Eloquent\\Model;'),
      'app/Models/Post.php': php('App\\Models', 'class Post extends BaseModel {}'),
    },
    expected: ['BND001', 'BND002'],
  },
  {
    name: 'query inside a closure in a controller',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function i() { return collect([1])->map(fn ($id) => User::findOrFail($id)); } }', 'use App\\Models\\User;'),
    expected: ['BND001', 'BND002'],
  },
  {
    name: 'model ::class reference from a controller',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function i() { return User::class; } }', 'use App\\Models\\User;'),
    expected: ['BND001'],
  },
  {
    name: 'type-only model hint in a controller (route model binding) under type_only: enforce',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function show(User $user): array { return []; } }', 'use App\\Models\\User;'),
    expected: ['BND001'],
  },
  {
    name: 'controller implements an interface from the repository layer',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController implements UserReader {}', 'use App\\Repositories\\UserReader;'),
    extra: { 'app/Repositories/UserReader.php': php('App\\Repositories', 'interface UserReader {}') },
    expected: ['BND001'],
  },
  {
    name: 'undocumented catch (\\Throwable) in a service',
    file: S,
    code: php('App\\Services', 'class UserService { public function i() { try { return 1; } catch (\\Throwable $e) { return 0; } } }'),
    expected: ['EXC001'],
  },
  {
    name: 'undocumented catch in a repository',
    file: R,
    code: php('App\\Repositories', 'class UserRepository { public function i() { try { return User::all(); } catch (\\Exception $e) { return []; } } }', 'use App\\Models\\User;'),
    expected: ['EXC001'],
  },
  {
    name: 'repository depends on a service (forbidden + cycle)',
    file: R,
    code: php('App\\Repositories', 'class UserRepository { public function i(UserService $s) { return $s->all(); } }', 'use App\\Services\\UserService;'),
    expected: ['BND001', 'BND004'],
  },
  {
    name: 'file outside every layer',
    file: 'app/Helpers/Money.php',
    code: php('App\\Helpers', 'class Money {}'),
    expected: ['CFG001'],
  },
  {
    name: 'file matching two layers',
    file: 'app/Services/Support/Thing.php',
    code: php('App\\Services\\Support', 'class Thing {}'),
    contract: {
      layers: {
        controller: ['app/Http/Controllers/**/*.php'],
        support: ['app/Support/**/*.php', 'app/Services/Support/**/*.php'],
        service: ['app/Services/**/*.php'],
        repository: ['app/Repositories/**/*.php'],
        model: ['app/Models/**/*.php'],
        shared: ['app/Http/Requests/**/*.php'],
      },
    },
    expected: ['CFG001'],
  },
  {
    name: 'syntax error is never a silent pass',
    file: S,
    code: '<?php\nnamespace App\\Services;\nclass UserService { public function i( { }\n',
    expected: ['ANL001'],
  },
  {
    name: 'unresolvable application class',
    file: S,
    code: php('App\\Services', 'class UserService { public function i() { return new Missing(); } }', 'use App\\Services\\Ghost\\Missing;'),
    expected: ['ANL001'],
  },
  {
    name: 'dynamic static ORM call is reported as unverified',
    file: S,
    code: php('App\\Services', 'class UserService { public function i(string $cls) { return $cls::where("a", 1)->get(); } }'),
    expected: ['ANL001'],
  },
  {
    name: 'real-time facade reaching a repository',
    file: C,
    code: php(String.raw`App\Http\Controllers`, 'class UserController { public function i() { return UserRepository::all(); } }', String.raw`use Facades\App\Repositories\UserRepository;`),
    expected: ['BND001'],
  },
  {
    name: 'custom facade that proxies a repository',
    file: C,
    code: php(String.raw`App\Http\Controllers`, 'class UserController { public function i() { return Users::all(); } }', String.raw`use App\Facades\Users;`),
    extra: {
      'app/Facades/Users.php': php(String.raw`App\Facades`, 'class Users extends Facade { protected static function getFacadeAccessor() { return UserRepository::class; } }', String.raw`use App\Repositories\UserRepository;` + '\n' + String.raw`use Illuminate\Support\Facades\Facade;`),
    },
    contract: FACADE_CONTRACT,
    expected: ['BND001'],
  },
];

const negative: Case[] = [
  {
    name: 'custom facade that proxies an allowed layer',
    file: C,
    code: php(String.raw`App\Http\Controllers`, 'class UserController { public function i() { return Support::go(); } }', String.raw`use App\Facades\Support;`),
    extra: {
      'app/Facades/Support.php': php(String.raw`App\Facades`, 'class Support extends Facade { protected static function getFacadeAccessor() { return UserSupport::class; } }', String.raw`use App\Support\UserSupport;` + '\n' + String.raw`use Illuminate\Support\Facades\Facade;`),
    },
    contract: FACADE_CONTRACT,
    expected: [],
  },
  {
    name: 'real-time facade reaching an allowed layer',
    file: C,
    code: php(String.raw`App\Http\Controllers`, 'class UserController { public function i() { return UserSupport::go(); } }', String.raw`use Facades\App\Support\UserSupport;`),
    expected: [],
  },
  {
    name: 'repository queries Eloquent',
    file: R,
    code: php('App\\Repositories', 'class UserRepository { public function i() { return User::query()->where("a", 1)->get(); } }', 'use App\\Models\\User;'),
    expected: [],
  },
  {
    name: 'repository uses the DB facade',
    file: R,
    code: php('App\\Repositories', 'class UserRepository { public function i() { return DB::table("users")->get(); } }', 'use Illuminate\\Support\\Facades\\DB;'),
    expected: [],
  },
  {
    name: 'controller → support',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function __construct(private UserSupport $s) {} }', 'use App\\Support\\UserSupport;'),
    expected: [],
  },
  {
    name: 'service uses DB::transaction (a boundary, not a query)',
    file: S,
    code: php('App\\Services', 'class UserService { public function i() { return DB::transaction(fn () => 1); } }', 'use Illuminate\\Support\\Facades\\DB;'),
    expected: [],
  },
  {
    name: 'documented catch (comment above)',
    file: S,
    code: php(
      'App\\Services',
      'class UserService { public function i() { try { return 1; }\n// nobypass-allow EXC001: retry transient gateway failure\ncatch (\\RuntimeException $e) { return 0; } } }',
    ),
    expected: [],
  },
  {
    name: 'documented catch (same line)',
    file: S,
    code: php(
      'App\\Services',
      'class UserService { public function i() { try { return 1; } catch (\\RuntimeException $e) { // nobypass-allow EXC001: wrap as domain error\n throw new \\DomainException("x", 0, $e); } } }',
    ),
    expected: [],
  },
  {
    name: 'catch in a controller (not discouraged there)',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function i() { try { return 1; } catch (\\Throwable $e) { return 0; } } }'),
    expected: [],
  },
  {
    name: 'controller uses a FormRequest from the shared layer',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function s(StoreUser $r) { return $r->validated(); } }', 'use App\\Http\\Requests\\StoreUser;'),
    extra: { 'app/Http/Requests/StoreUser.php': php('App\\Http\\Requests', 'class StoreUser {}') },
    expected: [],
  },
  {
    name: 'type-only model hint with type_only: ignore',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function show(User $user): array { return []; } }', 'use App\\Models\\User;'),
    contract: {
      dependencies: {
        allowed_direct: { controller: ['support'], support: ['service'], service: ['repository'], repository: ['model'], model: [], shared: ['*'] },
        shared: ['shared'],
        type_only: 'ignore',
      },
    },
    expected: [],
  },
  {
    name: 'framework facades (Cache) in a service',
    file: S,
    code: php('App\\Services', 'class UserService { public function i() { return Cache::get("k"); } }', 'use Illuminate\\Support\\Facades\\Cache;'),
    expected: [],
  },
  {
    name: 'service → service in the same layer',
    file: S,
    code: php('App\\Services', 'class UserService { public function __construct(private MailService $m) {} }'),
    extra: { 'app/Services/MailService.php': php('App\\Services', 'class MailService {}') },
    expected: [],
  },
  {
    name: 'model uses static:: on itself',
    file: 'app/Models/User.php',
    code: php('App\\Models', 'class User extends Model { public static function active() { return static::where("a", 1)->get(); } }', 'use Illuminate\\Database\\Eloquent\\Model;'),
    expected: [],
  },
  {
    name: 'catch policy disabled',
    file: S,
    code: php('App\\Services', 'class UserService { public function i() { try { return 1; } catch (\\Throwable $e) { return 0; } } }'),
    contract: {
      rules: {
        direct_orm_access: { enabled: true, deny_in: ['controller', 'support', 'service'], allow_in: ['repository'] },
        catch_policy: { enabled: false, discourage_in: ['service'] },
      },
    },
    expected: [],
  },
  {
    name: 'ORM rule disabled',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function i() { return DB::table("x")->get(); } }', 'use Illuminate\\Support\\Facades\\DB;'),
    contract: { rules: { direct_orm_access: { enabled: false, deny_in: ['controller'], allow_in: ['repository'] } } },
    expected: [],
  },
  {
    name: 'contract exception with a reason',
    file: S,
    code: php('App\\Services', 'class UserService { public function i() { return DB::table("legacy")->get(); } }', 'use Illuminate\\Support\\Facades\\DB;'),
    contract: { exceptions: [{ rule: 'BND002', path: 'app/Services/UserService.php', reason: 'Legacy import; refactor scheduled' }] },
    expected: [],
  },
  {
    name: 'excluded files are not analyzed',
    file: 'app/Console/Legacy.php',
    code: php('App\\Console', 'class Legacy { public function i() { return \\App\\Models\\User::all(); } }'),
    contract: { exclude: ['app/Console/**'] },
    expected: [],
  },
  {
    name: '`use function` is not a class dependency',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController {}', 'use function App\\Repositories\\helper;'),
    expected: [],
  },
  {
    name: 'external helpers (Str) in a controller',
    file: C,
    code: php('App\\Http\\Controllers', 'class UserController { public function i() { return Str::of("a")->upper(); } }', 'use Illuminate\\Support\\Str;'),
    expected: [],
  },
  {
    name: 'repository uses a DTO from the shared layer',
    file: R,
    code: php('App\\Repositories', 'class UserRepository { public function i(UserData $d) { return $d; } }', 'use App\\DTOs\\UserData;'),
    extra: { 'app/DTOs/UserData.php': php('App\\DTOs', 'final class UserData {}') },
    expected: [],
  },
  {
    name: 'model → model relation in the same layer',
    file: 'app/Models/Post.php',
    code: php('App\\Models', 'class Post extends Model { public function author() { return $this->belongsTo(User::class); } }', 'use Illuminate\\Database\\Eloquent\\Model;'),
    expected: [],
  },
];

function run(c: Case) {
  const contract = laravelContract(c.contract);
  const dir = project({ ...LARAVEL_BASE, ...(c.extra ?? {}), [c.file]: c.code }, contract);
  return check(dir);
}

describe('Laravel adapter — violations are caught', () => {
  it.each(positive.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(rulesIn(run(c), c.file)).toEqual([...c.expected].sort());
  });
});

describe('Laravel adapter — compliant code passes', () => {
  it.each(negative.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    const result = run(c);
    expect(rulesIn(result, c.file)).toEqual([]);
    expect(result.error).toBeNull();
  });
});

describe('Laravel base project', () => {
  it('is clean on its own', () => {
    const result = check(project(LARAVEL_BASE, laravelContract()));
    expect(rulesIn(result)).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});

export const LARAVEL_CASE_COUNTS = { positive: positive.length, negative: negative.length };
