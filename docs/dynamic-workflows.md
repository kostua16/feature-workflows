# Claude Code Dynamic Workflows — Полный справочник

> Требования: Claude Code **v2.1.154+**, платный план. Включается в `/config` → Dynamic workflows.
> Источники: [Claude Code Docs — Workflows](https://code.claude.com/docs/en/workflows), [Model configuration](https://code.claude.com/docs/en/model-config), [Awesome Claude — Workflows Guide](https://awesomeclaude.ai/claude-code-workflows), [Agent SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript).

---

## 1. Ключевая модель

**Dynamic workflow** — это JavaScript-скрипт, который оркестрирует субагентов. Скрипт держит цикл, ветвление и промежуточные результаты; в контекст сессии возвращается только финальный ответ.

**Важнейший момент:** сам JS-скрипт workflow **не имеет прямого доступа к файловой системе и shell**. Все чтения/записи/команды делают **субагенты**, которых он спавнит через `agent()`.

> «No direct FS / shell. The script coordinates agents; agents read, write, and run commands.»

---

## 2. Встроенные функции и глобалы

Полный список того, что доступно внутри тела скрипта (плоский JS с top-level `await`):

| Built-in | Сигнатура | Что делает |
|---|---|---|
| `agent()` | `agent(prompt, { schema?, label?, phase?, model?, isolation?, agentType? }) → Promise` | Спавнит одного субагента. Со `schema` (JSON Schema) возвращает валидированный объект; без — финальный текст. Возвращает `null`, если субагент пропущен или упал. |
| `pipeline()` | `pipeline(items, stage1, stage2, ...) → Promise<any[]>` | Прогоняет каждый item через все стадии **независимо, без барьера между стадиями**. Дефолт для многостадийной работы. Кинувшая исключение стадия «роняет» этот item в `null`. |
| `parallel()` | `parallel(thunks) → Promise<any[]>` | Запускает thunks конкурентно и ждёт всех — **это барьер**. Упавший thunk → `null`, поэтому нужен `.filter(Boolean)`. |
| `phase()` | `phase(title)` | Открывает новую группу в прогресс-дереве `/workflows`. |
| `log()` | `log(message)` | Пишет строку прогресса пользователю над деревом. |
| `workflow()` | `workflow(nameOrRef, args?) → Promise` | Запускает другой сохранённый workflow как под-шаг. **Вложенность ровно 1 уровень.** |
| `args` | `any` | Ввод, переданный сохранённому workflow. `undefined`, если не передан. Массивы/объекты приходят как настоящий JSON. |
| `budget` | `{ total, spent(), remaining() }` | Токен-бюджет из директивы `+Nk`. **Жёсткий потолок — `agent()` бросает исключение при пробое.** |

Обязательный заголовок скрипта:

```javascript
export const meta = {
  name: 'my-workflow',
  description: '...',
  phases: ['discover', 'analyze', 'verify'], // опционально
}
```

---

## 3. Работа с файлами (нет прямого FS)

Раз прямого FS у скрипта нет, паттерн такой:

```javascript
// 1) Discovery — субагент возвращает список файлов по JSON Schema
const found = await agent(
  'List every pom.xml under the current repo. Use Glob or Bash(find).',
  { schema: {
      type: 'object', required: ['files'],
      properties: { files: { type: 'array', items: { type: 'string' } } }
  }}
);

// 2) Fan-out через pipeline — на файл по субагенту (Read + Edit)
const results = await pipeline(found.files, file =>
  agent(
    `Read ${file}. Bump spring-boot-starter-parent to 3.3.4. ` +
    `Apply with Edit. Return { file, oldVersion, newVersion }.`,
    { label: file,
      schema: { type: 'object', properties: {
        file: {type:'string'}, oldVersion:{type:'string'}, newVersion:{type:'string'}
      }}}
  )
);

// 3) Верификация — второй, состязательный проход
const verified = await pipeline(results.filter(Boolean), r =>
  agent(`Run \`mvn -q -pl ${r.file.replace('/pom.xml','')} -am dependency:tree\` ` +
        `and confirm the new version resolves. Return { file, ok, notes }.`)
);

return verified.filter(Boolean);
```

Инструменты `Read`/`Write`/`Edit`/`Bash`/`Glob`/`Grep`/`WebSearch` — это тулы **субагента**, а не глобалы скрипта. Их доступность зависит от tool allowlist сессии. Субагенты workflow всегда работают в `acceptEdits`.

---

## 4. Контроль модели (Opus vs Sonnet)

По умолчанию:

> «Every agent in a workflow uses your session's model unless the script routes a stage to a different one.»

Приоритет резолвинга модели (от сильнейшего к слабейшему):

1. **`CLAUDE_CODE_SUBAGENT_MODEL`** — перекрывает и `model:` в `agent()`, и frontmatter субагента. **Самая частая причина, почему `model: 'opus'` игнорируется.**
2. **`availableModels` / organization restrictions** — блокированный override молча падает на inherited/default модель, без ошибки.
3. **Провайдер:** на Anthropic API `opus` = Opus 4.8, на Bedrock/Vertex/Foundry — Opus 4.6, на Claude Platform on AWS — Opus 4.7.
4. **Session model** (то, что показывает `/model`) — используется, если у `agent()` нет `model:`.
5. **Опечатка в имени** — на Anthropic API отклоняется с ошибкой, на Bedrock/Vertex/Foundry проходит молча.

### Рабочий паттерн: Opus для ревью и архитектуры, Sonnet для реализации

```javascript
export const meta = {
  name: 'audit-and-plan',
  phases: ['architecture', 'implement', 'review'],
}

phase('architecture');
const design = await agent(
  'Design the migration plan for module X ...',
  { model: 'claude-opus-4-8', label: 'architect' }
);

phase('implement');
const changes = await pipeline(files, file =>
  agent(`Apply the plan to ${file}`, {
    model: 'claude-sonnet-4-5',
    label: file,
  })
);

phase('review');
const reviews = await pipeline(changes.filter(Boolean), c =>
  agent(`Adversarially review the change in ${c.file}`, {
    model: 'claude-opus-4-8',
    label: `review:${c.file}`,
  })
);

return { design, reviews };
```

**Пинуйте полное имя** (`claude-opus-4-8`), а не alias `'opus'` — не зависит от alias-резолвинга провайдера.

### Чек-лист «почему всё ещё Sonnet»

- [ ] `env | grep SUBAGENT` — пусто или `inherit`
- [ ] `.claude/settings.json` не блокирует Opus через `availableModels`/`enforceAvailableModels`
- [ ] `/model` не Sonnet (или у каждого `agent()` явный `model:`)
- [ ] Передаёте полное имя (`claude-opus-4-8`), а не alias
- [ ] Провайдер реально даёт Opus 4.8
- [ ] Проверили `modelUsage` в результате / drill-in в `/workflows`

### Env-переменные для pinning aliases

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-8
export ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-5
# Разблокировать per-agent model override:
export CLAUDE_CODE_SUBAGENT_MODEL=inherit
```

### `opusplan` — что это и когда НЕ использовать

`opusplan` = Opus в plan mode, Sonnet в execution. **Для workflow с фазами это не подходит** — переключает по границе plan/execution, а не по вашим фазам. В workflow контроль модели идёт через параметр `model:` у каждого `agent()`.

---

## 5. Лимиты и подводные камни

| Область | Явная формулировка |
|---|---|
| Параллельные агенты | **16 concurrent** (меньше на слабых CPU); лишние встают в очередь |
| Всего агентов на run | **1 000 агентов** — backstop против runaway loops |
| Мид-run input | **Нет** — только permission-prompt агента может приостановить run |
| FS/shell в скрипте | **Нет прямого доступа** — только через субагентов |
| Resume | Только внутри одной сессии; выход из Claude Code = fresh restart |
| Кэш при resume | Завершённые агенты возвращают закэшированные результаты |
| Вложенность `workflow()` | Ровно 1 уровень |
| `agent()` upon failure | Возвращает `null` — **всегда `.filter(Boolean)`** перед дальнейшей обработкой |
| `budget.total` | Жёсткий потолок — `agent()` бросает исключение при пробое |
| Стоимость | Один run легко тратит на порядок больше токенов, чем разговор |

---

## 6. Best practices

- **Дефолт — `pipeline()`, не `parallel()`.** `parallel()` — барьер, ждёт всех; берите его только когда следующей стадии реально нужны все результаты сразу (судейская панель, сводный синтез).
- **Схемы важны.** Давайте `agent()` строгий JSON Schema, когда результат идёт в код — иначе будете парсить свободный текст.
- **`label`** — ставьте на каждый агент в fan-out’е (обычно имя файла/модуля). Это единственное, что делает прогресс-дерево читаемым.
- **`phase()` перед группами** `agent()` — визуально бьёт run на этапы (discover / transform / verify).
- **Adversarial verify** — фирменный паттерн workflow: агент делает работу, второй независимый агент проверяет её.
- **Isolation для миграций.** Для правок 500+ файлов используйте `isolation: 'worktree'` у `agent()`, чтобы каждый работал в git-worktree копии и правки не конфликтовали.
- **Сохранение.** После успешного run’а — `/workflows` → выбрать → `s` → `.claude/workflows/` (репо) или `~/.claude/workflows/` (только вы). Дальше вызывается как `/<name>` и принимает `args`.
- **Идемпотентность.** Пишите стадии так, чтобы повторный прогон был безопасен — resume вернёт кэш, но при ручных перезапусках это спасает.
- **Пред-approve тулов.** Добавьте `Bash(mvn:*)`, `Bash(git:*)`, `Bash(jira:*)` и т.п. в allowlist **до** запуска — иначе на длинном run’е получите prompt посреди работы (а мид-run input невозможен для скрипта).
- **Проверка спенда.** Гоняйте сначала на маленьком срезе (одна папка/модуль), смотрите per-agent usage в `/workflows`. В v2.1.202+ есть `Dynamic workflow size` в `/config` (`small`/`medium`/`large`).
- **MCP-тулы** (Jira MCP и т.п.) — тоже требуют allowlist; разрешите заранее.
- **Модель осознанно.** Тяжёлые reasoning-стадии — Opus по имени, рутина — Sonnet по имени. Не оставляйте на «сессионный дефолт», если фаз несколько.

---

## 7. Включение/отключение

| Control | Как работает |
|---|---|
| `/config` → Dynamic workflows | Toggle, persists across sessions |
| `"disableWorkflows": true` | В `~/.claude/settings.json` или managed settings |
| `CLAUDE_CODE_DISABLE_WORKFLOWS=1` | Env var, читается на старте |
| `/effort ultracode` | xhigh reasoning + автоматический workflow orchestration для любой substantive задачи в сессии |
| Keyword `ultracode` | В prompt-е — запускает конкретную задачу как workflow |
