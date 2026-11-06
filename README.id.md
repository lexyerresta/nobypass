# NoBypass

[English](README.md) · **Bahasa Indonesia**

[![ci](https://github.com/lexyerresta/nobypass/actions/workflows/ci.yml/badge.svg)](https://github.com/lexyerresta/nobypass/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**AI bilang sudah mengikuti arsitekturmu. Cek dulu.**

Situs dan demo langsung: **https://nobypass.nodezio.com** · oleh [Nodezio](https://nodezio.com)

NoBypass adalah pemeriksa berbasis command line untuk proyek **Laravel, Symfony, NestJS, Express, Fastify, Next.js, Django, FastAPI, dan Spring Boot**. Kamu menuliskan layer mana yang boleh memanggil layer mana, misalnya controller → service → repository → model. Setiap kali ada kode yang melompati jalur itu, NoBypass menggagalkan pemeriksaan, baik di lokal maupun di CI. Analisisnya statis dan berjalan offline, tanpa LLM, API key, atau akun.

NoBypass dibuat karena AI coding agent (dan manusia yang sedang lelah) sering menulis kode yang berfungsi, tapi diam-diam mengabaikan arsitekturmu:

```php
<?php

namespace App\Http\Controllers;

use App\Models\User;

class UserController extends Controller
{
    public function index()
    {
        return User::where('active', true)->get();   // works, passes tests, skips 2 layers
    }
}
```

```
$ npx nobypass check

✖ BND001 error app/Http/Controllers/UserController.php:11  Forbidden direct dependency
  controller depends directly on model: App\Models\User
  expected: controller may depend directly on: service; approved route to model: controller → service → repository → model
  fix:      Remove the dependency or route it through an allowed layer (service).

✖ BND002 error app/Http/Controllers/UserController.php:11  Data access outside approved layer
  controller performs data access: Eloquent query User::where()
  expected: Data access only in repository, reached via controller → service → repository
  fix:      Move the query into the repository layer and call it through controller → service → repository.

11 files analyzed · 2 new errors · 0 new warnings · 0 known (baseline/base)
✖ FAIL — 2 blocking findings.
```

Output CLI memang berbahasa Inggris. Pesan di atas adalah output asli dari kode contoh tersebut.

---

## Daftar isi

- [Mulai cepat (5 menit)](#mulai-cepat-5-menit)
- [Apa yang terjadi di tiap langkah](#apa-yang-terjadi-di-tiap-langkah)
- [Pemakaian sehari-hari](#pemakaian-sehari-hari)
- [File kontrak](#file-kontrak)
- [Stack dan preset yang didukung](#stack-dan-preset-yang-didukung)
- [Aturan (rules)](#aturan-rules)
- [Setup CI](#setup-ci)
- [Memakai bersama AI agent](#memakai-bersama-ai-agent)
- [Pertanyaan umum](#pertanyaan-umum)
- [Batasan](#batasan)
- [Kontribusi](#kontribusi)

---

## Mulai cepat (5 menit)

Kebutuhan: Node.js 20 atau lebih baru (CLI-nya ditulis dengan TypeScript), dan proyek dengan salah satu [stack yang didukung](#stack-dan-preset-yang-didukung) di dalam repositori git.

```bash
# 1. Pasang di proyekmu (rilis npm segera menyusul; sementara pasang dari GitHub)
npm install --save-dev github:lexyerresta/nobypass

# 2. Biarkan NoBypass membaca proyekmu dan mengusulkan kontrak
npx nobypass init

# 3. Baca apa yang ditemukan
npx nobypass discovery show

# 4. Setujui kontraknya (oleh kamu sendiri di terminal, bukan oleh CI atau agent)
npx nobypass approve

# 5. Jalankan pemeriksaan
npx nobypass check
```

Kalau proyekmu sudah punya pelanggaran, langkah 5 akan menampilkannya. Perbaiki, atau catat sekali sebagai utang yang sudah diketahui supaya hanya pelanggaran baru yang menggagalkan pemeriksaan:

```bash
npx nobypass baseline create
npx nobypass check --since origin/main   # gagal hanya untuk pelanggaran baru di branch ini
```

**Proyek Python, Java, atau PHP tanpa `package.json`?** Lewati langkah 1, lalu awali setiap perintah dengan paket GitHub-nya, misalnya `npx --yes github:lexyerresta/nobypass init`. Node.js tetap dibutuhkan, tapi tidak ada yang ditambahkan ke proyekmu.

## Apa yang terjadi di tiap langkah

| Langkah | Perintah | Yang dilakukan | File yang ditulis |
|---|---|---|---|
| 1 | `npm install -D …` | Menambahkan CLI ke `devDependencies`. | `package.json`, lockfile |
| 2 | `init` | Mendeteksi framework dari manifest (`composer.json`, `package.json`, `pyproject.toml`/`requirements.txt`, `pom.xml`/`build.gradle`), membaca PSR-4 atau path `tsconfig`, mulai dari preset framework tersebut, lalu membuang layer yang tidak ada di proyekmu. Monorepo mendapat satu entri project per aplikasi. | `.nobypass.proposed.yml`, `.nobypass/discovery.txt` |
| 3 | `discovery show` | Menampilkan buktinya: layer, jumlah file yang dicakup tiap layer, file yang tidak masuk layer mana pun atau ambigu, dan setiap tempat di mana kode yang ada bertentangan dengan usulan. | tidak ada |
| 4 | `approve` | Memvalidasi usulan, menampilkan ringkasan, lalu memintamu mengetik `approve`. Menolak berjalan di CI. | `.nobypass.yml` |
| 5 | `check` | Menganalisis kode terhadap kontrak yang sudah disetujui. Hanya membaca. | tidak ada |

`init` tidak pernah menyentuh kode sumber maupun instruksi agent-mu. Kalau usulannya keliru, edit `.nobypass.proposed.yml` sebelum menyetujuinya. Isinya YAML biasa.

## Pemakaian sehari-hari

| Kamu ingin | Jalankan |
|---|---|
| Memeriksa seluruh proyek | `npx nobypass check` |
| Memeriksa hanya yang berubah di branch ini (termasuk file yang belum di-commit) | `npx nobypass check --since origin/main` |
| Memahami sebuah temuan | `npx nobypass explain BND002 --file app/Http/Controllers/UserController.php` |
| Membuat warning ikut menggagalkan pemeriksaan | `npx nobypass check --strict` |
| Mendapat output yang bisa dibaca mesin | `npx nobypass check --format json` atau `--format sarif --output nobypass.sarif` |
| Menerima pelanggaran lama sebagai utang yang sudah ditinjau | `npx nobypass baseline create` |
| Memberi tahu AI agent tentang kontrak | `npx nobypass agents generate --skill` |

Exit code: `0` lolos · `1` ada pelanggaran baru · `2` kontrak tidak valid atau ada file yang gagal dianalisis · `3` belum ada kontrak yang disetujui.

## File kontrak

`.nobypass.yml` adalah satu-satunya sumber kebenaran. Commit file ini dan lindungi dengan CODEOWNERS (lihat [Setup CI](#setup-ci)).

```yaml
schema: 1
projects:
  - id: api
    root: .
    language: php                # php | typescript | python | java
    framework: laravel           # laravel | symfony | nestjs | express | fastify | nextjs | django | fastapi | spring | generic
    layers:                      # nama: glob ("!glob" untuk mengecualikan)
      controller: ["app/Http/Controllers/**/*.php"]
      service:    ["app/Services/**/*.php"]
      repository: ["app/Repositories/**/*.php"]
      model:      ["app/Models/**/*.php"]
      shared:     ["app/Http/Requests/**/*.php", "app/Providers/**/*.php", "app/Facades/**/*.php"]
    dependencies:
      allowed_direct:            # siapa boleh bergantung LANGSUNG ke siapa
        controller: [service]
        service:    [repository]
        repository: [model]
        model:      []
        shared:     ["*"]
      shared: [shared]           # layer yang boleh dipakai semua layer
    rules:
      direct_orm_access:         # di mana akses database diizinkan
        deny_in:  [controller, service]
        allow_in: [repository]
      catch_policy:              # di mana try/catch harus punya alasan tertulis
        discourage_in: [service, repository]
        severity: warning
    exceptions:                  # pengecualian yang sudah ditinjau dan ditulis alasannya
      - rule: BND002
        path: app/Services/LegacyImportService.php
        reason: "Legacy integration; refactor scheduled"
```

Tiga hal yang perlu diketahui:

1. **Hanya dependency langsung.** `allowed_direct` memeriksa dependency langsung. Controller yang mencapai model *melalui* service dan repository tidak masalah. Controller yang langsung mengimpor model, itu yang dilarang.
2. **Salah ketik langsung ketahuan.** Key yang tidak dikenal dan rujukan ke layer yang tidak dideklarasikan dianggap error, tidak pernah diabaikan diam-diam.
3. **Pengecualian wajib punya alasan.** Rule tingkat error hanya bisa dikecualikan di sini, di file yang ikut di-review. Satu-satunya pengecualian inline adalah untuk rule catch yang tingkatnya warning: `// nobypass-allow EXC001: <alasan>`.

Skema lengkapnya ada di [docs/rule-reference.md](docs/rule-reference.md#contract-schema).

## Stack dan preset yang didukung

`init` mendeteksi framework dari manifest, mulai dari preset-nya, lalu menyesuaikannya dengan folder yang benar-benar ada di proyekmu. Setiap preset mengikuti pola publik yang terdokumentasi luas.

| Stack | Dideteksi dari | Pembagian layer default | Pola yang diikuti |
|---|---|---|---|
| **Laravel** | `composer.json` → `laravel/framework` | controller → service → repository → model | Service Layer + Repository (Fowler, *PoEAA*); binding interface di service provider (dokumentasi Laravel) |
| **Symfony** | `composer.json` → `symfony/framework-bundle` | controller → service → repository → entity | Best practice Symfony; Doctrine Data Mapper dengan class repository |
| **NestJS** | `package.json` → `@nestjs/core` | controller → service → repository → persistence | Provider Nest; preset ports-and-adapters kalau ada `src/domain` + `src/application` atau `src/infrastructure` |
| **Express / Fastify** | `package.json` → `express` / `fastify` | route → controller → service → repository → model / persistence | Controller-service-repository untuk API Node.js |
| **Next.js** | `package.json` → `next` | UI (app/, pages/, components/) → Data Access Layer → database | Dokumentasi Next.js, "Data Security": gunakan Data Access Layer |
| **Django** | `requirements*.txt` / `pyproject.toml` / `Pipfile` → Django | views → services / selectors → models | HackSoftware Django Styleguide |
| **FastAPI** | manifest Python yang sama → FastAPI | routers → services → repositories → models | Router/service/repository dengan session SQLAlchemy |
| **Spring Boot** | `pom.xml` / `build.gradle` → `spring-boot` | controller → service → repository → entity | Stereotype Spring (`@Controller`, `@Service`, `@Repository`) dan Spring Data |

Yang dihitung sebagai **akses database** (rule `BND002`) di tiap stack:

| Stack | Dideteksi sebagai akses data |
|---|---|
| Laravel | Panggilan Eloquent statis (`User::where()`, `User::create()`, …), `new Model()`, `DB::table/select/insert/…`. `DB::transaction()` boleh di mana saja. |
| Symfony | Panggilan pada `EntityManagerInterface`, `ManagerRegistry`, atau DBAL `Connection` yang di-inject (`$this->em->persist()`, `$em->flush()`, …) |
| NestJS, Express, Fastify, Next.js | Panggilan lewat client yang di-inject atau diimpor (`PrismaService`, `prisma`, `db`, `knex`, TypeORM `Repository`/`EntityManager`/`DataSource`, `@InjectRepository`/`@InjectModel`), `new PrismaClient()`, dan query model Mongoose/Sequelize statis (`User.find()`, `User.findAll()`) |
| Django | Query `Model.objects.…` dan `django.db.connection` |
| FastAPI | Panggilan pada `Session`/`AsyncSession`, termasuk session dari `Depends(get_db)` dan `with Session(engine) as s` |
| Spring Boot | Panggilan pada `EntityManager`, `JdbcTemplate`, `NamedParameterJdbcTemplate`, `JdbcClient`, `MongoTemplate`, `DSLContext`, `Session` Hibernate, atau `SqlSession` MyBatis yang di-inject |

Detail per stack:
- **Facade Laravel dipahami.** Panggilan lewat custom facade (`getFacadeAccessor()` yang mengembalikan class) atau real-time facade (`use Facades\App\...`) dihitung sebagai dependency ke class di baliknya. Jadi facade tidak bisa menyembunyikan panggilan controller → repository.
- **TypeScript dan JavaScript** (`.ts .tsx .js .jsx .mjs .cjs`, ESM maupun CommonJS) ikut dianalisis. Path alias `tsconfig` di-resolve, dan `import type` dilaporkan sebagai type-only.
- **Python**: import absolut, import relatif, dan layout `src/` di-resolve. Import di dalam `if TYPE_CHECKING:` dianggap type-only.
- **Java**: class di-resolve dari layout standar Maven/Gradle `src/main/java`, termasuk wildcard import dan rujukan antar class dalam package yang sama.

Preset hanyalah titik awal. Kamu bebas mengganti nama layer, menambah atau membuang layer (misalnya layer `support` di antara controller dan service), dan memakai satu entri project per aplikasi di monorepo.

## Aturan (rules)

| Rule | Yang ditangkap | Default |
|---|---|---|
| `BND001` | Dependency langsung yang tidak diizinkan kontrak | error |
| `BND002` | Akses database atau ORM di luar layer yang diizinkan | error |
| `BND003` | Melompati tepat satu layer (misalnya controller → repository padahal jalurnya controller → service → repository) | error |
| `BND004` | Siklus dependency antar layer | error |
| `EXC001` | `catch` di layer yang tidak dianjurkan oleh kontrak, tanpa alasan tertulis | warning |
| `CFG001` | File dalam cakupan yang tidak cocok dengan layer mana pun, atau cocok dengan lebih dari satu | warning |
| `ANL001` | File yang gagal di-parse atau rujukan yang tidak bisa di-resolve. Tidak pernah diloloskan diam-diam. | error |

Setiap temuan menyebutkan file, baris, kedua layer, apa yang seharusnya, dan cara memperbaikinya. Detailnya ada di [docs/rule-reference.md](docs/rule-reference.md).

## Setup CI

```yaml
# .github/workflows/architecture.yml
name: architecture
on: pull_request
jobs:
  nobypass:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # --since butuh riwayat branch base
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci                        # memasang nobypass dari devDependencies
      - run: npx nobypass check --since origin/${{ github.base_ref }} --format sarif --output nobypass.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: nobypass.sarif }
```

Setelah itu:
1. Jadikan check `architecture` **wajib** di branch protection.
2. Lindungi kontraknya supaya tidak ada yang bisa melonggarkannya tanpa review, baik manusia maupun agent:
   ```
   # .github/CODEOWNERS
   /.nobypass.yml           @your-org/architects
   /.nobypass/baseline.json @your-org/architects
   ```

## Memakai bersama AI agent

```bash
npx nobypass agents generate --skill
```

Perintah ini menambahkan blok bertanda ke `AGENTS.md` (meminta izin dulu kalau file-nya sudah ada) dan menulis `.claude/skills/nobypass/SKILL.md`. Isi bloknya meminta agent mengikuti `.nobypass.yml`, menjalankan `npx nobypass check --since origin/main` sebelum menyatakan tugas selesai, dan tidak pernah mengedit kontrak atau baseline supaya pemeriksaan lolos. Jalankan lagi setelah kontrak berubah; perintah ini hanya mengganti bloknya sendiri.

Instruksi bisa diabaikan oleh agent. Check CI yang wajib tidak bisa. Pakai keduanya.

## Pertanyaan umum

**Apakah kode lamaku akan langsung gagal?** `check` biasa melaporkan semuanya. Jalankan `baseline create` sekali untuk mencatat pelanggaran yang sudah ada sebagai utang yang sudah ditinjau, atau pakai `--since origin/main` supaya hanya pelanggaran baru yang menggagalkan pemeriksaan. Salinan kedua dari pelanggaran lama di file yang sama tetap dilaporkan sebagai pelanggaran baru.

**Bisakah agent mengedit `.nobypass.yml` begitu saja?** Di lokal, bisa. Karena itulah kontrak dan baseline sebaiknya dilindungi CODEOWNERS, dan `check --since` akan memberi peringatan kalau salah satu file itu berubah di diff. `approve` dan `baseline create` juga menolak berjalan di CI.

**Bagaimana kalau ada file yang tidak bisa dipahami?** NoBypass melaporkan `ANL001` dan gagal (exit code 2). Kode yang tidak bisa dianalisis tidak pernah dilaporkan PASS. Panggilan dinamis seperti `$class::where()` dilaporkan sebagai warning yang belum terverifikasi.

**Apakah kodeku dikirim ke luar komputer?** Tidak. Analisisnya lokal dan statis, dan NoBypass tidak pernah menjalankan kode proyekmu.

## Batasan

NoBypass membuktikan bahwa pelanggaran yang *bisa dideteksi* tidak ada. Itu lebih sempit daripada "kodenya benar". NoBypass memeriksa dependency statis langsung, bukan alur panggilan saat runtime. Panggilan ORM pada variabel tanpa tipe seperti `$user->save()` tidak terlihat olehnya. File yang tidak cocok dengan layer mana pun hanya diberi warning (`CFG001`). Daftar lengkapnya ada di [docs/limitations.md](docs/limitations.md) (dalam bahasa Inggris).

## Kontribusi

```bash
git clone https://github.com/lexyerresta/nobypass.git
cd nobypass
npm install          # sekaligus membangun dist/
npm test             # 186 tes: kasus rule untuk tiap adapter dan stack, fixture, --since, discovery, CLI
node dist/cli/index.js check -C fixtures/laravel-violations
```

```
src/cli/                  perintah CLI
src/core/                 skema kontrak, layer, rule, fingerprint, baseline, git, check, explain
src/adapters/php/         AST PHP, PSR-4, Eloquent, facade DB, facade Laravel
src/adapters/typescript/  AST TS/JS, import dan path alias, Prisma/TypeORM/Drizzle/Mongoose
src/adapters/python/      Python (tree-sitter): import, ORM Django, session SQLAlchemy
src/adapters/java/        Java (tree-sitter): import, handle JPA/JDBC/jOOQ
src/discovery/            deteksi proyek dan pembuatan usulan
src/agents/               pembuatan AGENTS.md / SKILL.md
presets/                  satu preset YAML per stack (laravel, symfony, nestjs, node-api, nextjs, django, fastapi, spring)
grammars/                 grammar tree-sitter siap pakai (WebAssembly, MIT); tidak perlu build native
fixtures/                 satu contoh proyek valid dan satu yang melanggar untuk tiap stack
site/                     landing page (statis, di-deploy di Vercel dengan Root Directory = site)
```

Demo di landing page (`site/demo-data.js`) dihasilkan dari fixture oleh checker yang sesungguhnya. Jalankan `npm run site:demo` setelah mengubah fixture atau rule. CI akan gagal kalau file yang di-commit sudah tidak sesuai.

Untuk menambah detektor atau rule, tulis dulu satu kasus pelanggaran dan satu kasus yang patuh di file tes yang sesuai (`test/laravel.test.ts`, `test/nestjs.test.ts`, atau `test/stacks.test.ts`). Adapter hanya menghasilkan fakta yang sudah dinormalisasi (dependency, operasi akses data, lokasi catch, rujukan yang tidak ter-resolve), sedangkan rule-nya ada di `src/core/rules.ts`.

Landing page di `site/` didesain dengan aturan [anti-slop](https://github.com/miqdadbadjuber/anti-slop) karya Miqdad Badjuber (MIT). Arah desainnya ada di [site/DESIGN.md](site/DESIGN.md) dan laporan gate-nya di [site/DELIVERY-GATE.md](site/DELIVERY-GATE.md). Font yang dipakai adalah IBM Plex (SIL OFL 1.1, lihat `site/fonts/OFL.txt`).

## Lisensi

MIT © Nodezio
