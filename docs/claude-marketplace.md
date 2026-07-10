# GitHub-репозиторий для Claude Code Marketplace и Claude Plugins: структура, правила, лучшие практики

## 1. Цели и общая архитектура репозитория

Главная задача такого репозитория — одновременно быть:
- источником Claude Code marketplace (каталог плагинов и skills);
- местом хранения самих плагинов (agents, skills, workflows, MCP, hooks);
- документацией по их использованию и развитию.[^1][^2][^3]

Для этого репозиторий обычно включает:
- корневой уровень (CLAUDE.md, LICENSE, CONTRIBUTING, README, базовые GitHub-правила);
- `.claude-plugin/marketplace.json` для описания маркетплейса;
- одну или несколько папок с плагинами (`plugins/`, `external_plugins/` или аналогичное);
- общие docs и примеры, которые помогают пользователям и контрибьюторам.[^3][^4][^1]

## 2. Базовая структура репозитория

### 2.1. Корневой уровень

Рекомендуемая структура в корне:

```text
repo-root/
├── CLAUDE.md
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── .gitignore
├── .claude-plugin/
│   └── marketplace.json
├── plugins/            # внутренние или примерные плагины
├── external_plugins/   # внешние или сторонние плагины (опционально)
└── docs/
    ├── QUICKSTART.md
    └── ARCHITECTURE.md
```

Такой шаблон совпадает с практикой официального каталога плагинов Anthropic и популярных community-репозиториев.[^5][^6][^3]

### 2.2. Структура отдельного плагина

Каждый плагин следует стандартной структуре Claude Code:[^4][^3]

```text
plugin-name/
├── .claude-plugin/
│   └── plugin.json      # обязательный манифест плагина
├── .mcp.json            # конфиг MCP-сервера (опционально)
├── commands/            # slash-команды (/deploy, /lint и т.п.)
├── agents/              # специализированные агенты
├── skills/              # SKILL.md-файлы (workflows / знания)
├── hooks/               # event hooks (SessionStart и т.п.)
└── README.md            # документация по плагину
```

Для skill‑bundle плагинов (репозиторий содержит лишь набор SKILL.md без собственного `plugin.json`) marketplace‑запись может явно перечислять skills и работать в "strict: false" режиме.[^3]

## 3. Marketplace: `.claude-plugin/marketplace.json`

### 3.1. Назначение файла

Marketplace — это каталог плагинов, а не их содержимое. Сам файл:[^7]
- объявляет имя маркетплейса и владельца;
- перечисляет плагины (name, description, категория, источник);
- может ссылаться на локальные директории или внешние репозитории.[^2][^1]

Минимальный пример:

```json
{
  "name": "my-claude-marketplace",
  "owner": { "name": "Konstantin Leontyev" },
  "plugins": [
    {
      "name": "devops-tooling",
      "description": "DevOps agents, workflows and MCP integration",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/username/claude-devops-plugins.git",
        "path": "plugins/devops-tooling",
        "ref": "main"
      },
      "category": "devops",
      "homepage": "https://github.com/username/claude-devops-plugins"
    }
  ]
}
```

### 3.2. Типы `source` и стратегия разбиения по репозиториям

Официальная документация и практические гайды рекомендуют использовать разные `source`‑типы для гибкой организации:[^1][^7]

| Source type | Назначение | Пример |
|-------------|-----------|--------|
| `"./"` (relative path) | Плагин в том же репо | `"source": "./plugins/devops"` |
| `github` | GitHub‑репозиторий по `owner/repo` | плагин из общего public‑репо |
| `url` | произвольный Git‑URL | HTTPS‑ссылка на GitHub или другой Git-хостинг |
| `git-subdir` | сабдиректория внутри Git‑репо | монорепозиторий, где плагин лежит в `packages/...` |
| `npm` / `pip` | поставка плагина как пакета | SDK‑ориентированные плагины |

Практика: держать marketplace как отдельный "каталог"-репозиторий, а плагины — в отдельных репо по доменам (DevOps, frontend, data, infra и т.п.). Это:
- уменьшает ответственность одного maintainer;
- позволяет разным командам развивать свои плагины независимо;
- сохраняет единый точку входа для пользователей через один marketplace.[^7][^2]

## 4. CLAUDE.md и документация: архитектура контекста

### 4.1. Роль CLAUDE.md

CLAUDE.md — это устойчивый проектный контекст Claude Code, который загружается детерминированно, но интерпретируется вероятностной моделью. В репозитории маркетплейса он:[^8]
- описывает общие принципы разработки плагинов, skills и agents;
- задаёт код‑стайл, структуру папок и правила PR;
- может ссылаться на более подробные docs, а не инлайнить их.[^9][^10]

Рекомендуемый подход:
- CLAUDE.md как лёгкий индекс/роутер, а не свалка всех знаний;
- подробности архитектуры и процессов — в `docs/ARCHITECTURE.md`, `docs/WORKFLOWS.md` и т.п., которые агент читает по мере необходимости.[^10][^11]

### 4.2. Иерархия: от общего к частному

Практика живых команд под Claude Code:
- `CLAUDE.md` в корне — базовые правила проекта;
- `agents/*.md` — описания ролей и контекст для агентов;
- `skills/**/SKILL.md` — task‑level workflows, загружаемые по запросу;
- `docs/*.md` — глубокие объяснения архитектуры, DevOps‑инфраструктуры и т.п.[^12][^11][^10]

Идея: агенты и skills скорее ссылаются на документацию, чем повторяют её текст, чтобы не раздувать контекст.

## 5. Структура `agents/` и дизайн агентов

### 5.1. Организация каталога агентов

Агенты имеют узкую специализацию и отдельное окно контекста, не загрязняющее основную сессию. Рекомендуется структура:[^13][^8]

```text
agents/
├── code-reviewer.md
├── devops-deployer.md
├── mcp-integrator.md
├── docs-writer.md
└── ...
```

Каждый файл описывает:
- роль агента;
- набор инструментов и skills, которые он использует;
- workflow (пронумерованные шаги);
- критерии успешного завершения.[^14][^13]

### 5.2. Шаблон файла агента

Гайды по созданию агентов рекомендуют формат:[^13][^14]

```markdown
---
name: devops-deployer
description: Handles deployment workflows for Kubernetes and Docker-based services.
tools: ["kubectl", "docker", "mcp:ci-server"]
model: inherit
---

You are a deployment specialist for this project's infrastructure.

When invoked:
1. Inspect current git branch and pending changes.
2. Read relevant deployment docs in docs/deploy/*.md.
3. Plan deployment steps and validate against CLAUDE.md rules.
4. Execute or propose commands via shell tools.
5. Report status and rollback strategy.

Success criteria:
- Deployment plan is safe and reversible.
- All steps are logged.
- User has clear next actions.
```

Лучшие практики:
- single responsibility: агент делает одну вещь хорошо;
- ясный триггер ("после PR", "перед деплоем" и т.п.);
- чёткая пошаговая инструкция вместо общих фраз;[^13]

## 6. Структура `skills/` и авторинг SKILL.md

### 6.1. Что такое Skills

Skills — файловые, переиспользуемые ресурсы для Claude: workflows, контекст и best practices под конкретные задачи. Они:[^12]
- загружаются по требованию (user‑invocable или auto‑invocable);
- могут использоваться разными агентами;
- держат task‑level логику (напр. `/deploy`, `/code-review`, `/lint`).[^15][^12]

### 6.2. Организация каталога skills

Практичный паттерн:

```text
skills/
├── deploy/
│   └── SKILL.md
├── code-review/
│   └── SKILL.md
├── mcp-setup/
│   └── SKILL.md
└── workflows/
    └── feature-dev/
        └── SKILL.md
```

Глобальный CLAUDE.md даёт краткие ссылки вида: "см. `skills/deploy/SKILL.md` для полного deploy‑workflow", без инлайна содержимого.[^11][^10]

### 6.3. Шаблон SKILL.md и best practices

Документация по Skill authoring советует:[^15][^12]
- краткие, хорошо структурированные файлы;
- явный раздел Purpose;
- пошаговый workflow;
- чёткие ограничения и ожидания результата.

Пример:

```markdown
---
description: Deploy the current service to Kubernetes using best practices.
auto_invoke: false
---

## Purpose
Use this skill when you want to deploy the current service to the Kubernetes cluster.

## Prerequisites
- CLAUDE.md contains up-to-date infra overview.
- Kubernetes context is configured in kubeconfig.

## Workflow
1. Read docs/deploy/architecture.md and docs/deploy/checklist.md.
2. Inspect current git status and pending changes.
3. Generate deployment plan including rollout strategy and rollback.
4. Execute `kubectl` commands via shell tool, or propose them for manual execution.
5. Verify health with `kubectl get pods` and service checks.

## Output
- Deployment summary.
- Commands executed or to be executed.
- Observed status and recommended follow-ups.
```

## 7. Workflows, routines и "agentic" паттерны

### 7.1. Workflows и routines в Claude Code

Workflows позволяют оркестрировать сабагентов и skills в сложные цепочки, а routines делают агенты проактивными (по расписанию или триггерам). В контексте GitHub‑репозитория это обычно:[^16][^17]
- отдельные файлы в `skills/workflows/**` с описанием многошагового процесса (feature-dev, code-review, deploy);
- настройки в `.claude/settings.json` для hooks и план‑режима;
- отдельные agents для проверки, генерации и ревью.[^18][^4]

### 7.2. Репозиторий как "workflow showcase"

Хороший маркетплейс‑репозиторий не просто хранит плагины, но и демонстрирует:
- примерные workflow‑skills для разработки фич, ревью, миграций;
- как использовать Plan Mode и hooks для защиты репо;
- GitHub Actions, которые запускают Claude Code агента на PR или расписание.[^19][^18]

Пример структуры:

```text
.workflows/
├── feature-dev.yml       # GitHub Actions для запуска Claude Code workflows
└── pr-review.yml

skills/workflows/feature-dev/SKILL.md
skills/workflows/pr-review/SKILL.md
agents/code-reviewer.md
```

## 8. MCP‑серверы, `.mcp.json` и интеграции

### 8.1. MCP‑серверы как внешние инструменты

Плагины и репозитории часто инкапсулируют MCP‑серверы для доступа к БД, CI/CD, observability и пр. `.mcp.json` описывает:[^4][^3]
- как подключиться к серверу;
- какие tools доступны;
- какие агенты и skills используют эти tools.

Лучшие практики:
- документировать MCP в отдельном `docs/mcp/*.md`;
- не помещать внутреннюю реализацию MCP в CLAUDE.md — только высокоуровневое описание;
- держать секреты вне репозитория, используя переменные окружения и GitHub Secrets.[^7]

### 8.2. Структура для MCP‑интеграций

```text
mcp/
├── ci-server/
│   └── README.md
├── observability/
│   └── README.md
└── db-access/
    └── README.md

.mcp.json
```

Агенты и skills ссылаются на эти MCP‑описания, но не дублируют конфигурацию.[^12]

## 9. GitHub‑правила: ветки, PR, security

### 9.1. Branch strategy и protection rules

Для marketplace‑ и plugin‑репозиториев особенно важны:
- защищённые ветки (main/master) с обязательным PR‑флоу;
- требования к CI (линтеры, тесты, security‑сканы);
- запрет force‑push и прямых коммитов в main.[^3]

Плагины часто распространяют код, который будет выполняться у других людей, поэтому репозиторий должен строго следовать security‑практикам:
- минимум зависимостей;
- проверка MCP‑серверов и их доступа;
- code review с помощью агентов (например, code-review плагин).[^4][^3]

### 9.2. CONTRIBUTING.md и release‑процесс

Внешние контрибьюторы должны видеть:
- как предложить новый плагин или skill;
- какие требования к README, LICENSE, структуре;
- как устроен семантический versioning и changelog.[^6][^3]

Release‑процесс может включать:
- обновление `marketplace.json` с новыми версиями;
- автоматическое тестирование плагинов;
- публикацию релизов и тегов.

## 10. Документация и QUICKSTART для пользователей и контрибьюторов

### 10.1. QUICKSTART для пользователей

Практика community‑репозиториев — иметь `docs/QUICKSTART.md` с:
- инструкциями по установке Claude Code и добавлению marketplace (`/plugin marketplace add`);
- примером установки и запуска одного плагина;
- FAQ и troubleshooting секцией.[^5][^6]

### 10.2. QUICKSTART для авторов плагинов

Отдельный раздел или файл:
- "Creating Your First Plugin" с шаблоном структуры;
- примеры `plugin.json`, SKILL.md и agents;
- best practices по naming, categories, README.[^20][^5]

Это снижает порог входа и выравнивает качество плагинов.

## 11. Взаимодействие CLAUDE.md, Skills, Agents и MCP в больших проектах

### 11.1. Логическая модель

Сообщества и блоги по Claude Code предлагают смотреть на связку так:[^14][^10][^11]
- CLAUDE.md — индекс правил и ресурсов, минимальный, но стабильный;
- Agents — роли, использующие эти правила и ресурсы;
- Skills — конкретные workflows и знания, загружаемые по запросу;
- MCP — внешние инструменты, документированные отдельно.

Так строится иерархия "от общего к частному", которая масштабируется без взрыва контекста.

### 11.2. Практические советы по структурированию

- Делить плагины по доменам (frontend, devops, data, infra) и хранить их в отдельных репо, а marketplace — в одном.[^2][^7]
- Держать CLAUDE.md компактным и ссылочным, а подробные инструкции — в docs и SKILL.md.[^10][^8]
- Использовать GitHub Actions и routines Claude Code для автоматизации PR‑review и деплоя.[^18][^19]
- Строго следить за security и скорингом плагинов, особенно внешних.[^3]

## 12. Рекомендованный шаблон репозитория под ваши задачи

С учётом лучших практик и типичных примеров, рекомендуемый каркас GitHub‑репозитория для Claude Code marketplace + Claude plugins (agents, workflows, MCP) может выглядеть так:

```text
claude-marketplace-and-plugins/
├── CLAUDE.md
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── .gitignore
├── .claude-plugin/
│   └── marketplace.json
├── plugins/
│   ├── devops-tooling/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   ├── agents/
│   │   ├── skills/
│   │   ├── hooks/
│   │   ├── .mcp.json
│   │   └── README.md
│   └── frontend-design/
│       └── ...
├── external_plugins/
│   └── ...
├── skills/
│   ├── deploy/
│   │   └── SKILL.md
│   ├── code-review/
│   │   └── SKILL.md
│   └── workflows/
│       └── feature-dev/
│           └── SKILL.md
├── agents/
│   ├── code-reviewer.md
│   ├── devops-deployer.md
│   └── mcp-integrator.md
├── mcp/
│   ├── ci-server/
│   ├── observability/
│   └── db-access/
├── docs/
│   ├── QUICKSTART.md
│   ├── ARCHITECTURE.md
│   └── WORKFLOWS.md
└── .github/
    └── workflows/
        ├── pr-review.yml
        └── marketplace-validation.yml
```

Такой шаблон:
- совместим с Claude Code marketplace и plugin‑схемой;[^1][^4][^3]
- отражает иерархию CLAUDE.md → agents → skills → MCP и docs;[^11][^14][^10]
- удобно масштабируется по доменам и командам, оставаясь понятным пользователям и контрибьюторам.[^6][^7]

---

## References

1. [Create and distribute a plugin marketplace - Claude Code Docs](https://code.claude.com/docs/en/plugin-marketplaces) - Create .claude-plugin/marketplace.json in your repository root. This file defines your marketplace's...

2. [Build Your Own Claude Code Marketplace](https://dev.to/nagell/build-your-own-claude-code-marketplace-scaffold-structure-and-auto-updates-4n3f) - TL;DR: A Claude Code marketplace is a GitHub repo with a specific folder structure. You create plugi...

3. [anthropics/claude-plugins-official ...](https://github.com/anthropics/claude-plugins-official) - Plugins can be installed directly from this marketplace via Claude Code's plugin system. To install,...

4. [claude-code/plugins/README.md at main - GitHub](https://github.com/anthropics/claude-code/blob/main/plugins/README.md) - This directory contains some official Claude Code plugins that extend functionality through custom c...

5. [claude-code-marketplace/docs/QUICKSTART.md at main](https://github.com/GLINCKER/claude-code-marketplace/blob/main/docs/QUICKSTART.md) - Quick Start Guide · For Users: Installing and Using Skills · For Contributors: Creating Your First S...

6. [JanSzewczyk/claude-plugins: Claude Code marketplace ... - GitHub](https://github.com/JanSzewczyk/claude-plugins) - Shared skills and agents for Claude Code — covering Next.js, testing, Firebase, and more. Plugins • ...

7. [Internal Claude Code Plugin: Referencing and distributing plugins ...](https://dev.classmethod.jp/en/articles/claude-code-marketplace-source-external-repo/)

8. [How to Use CLAUDE.md, Skills & Hooks in Claude Code | Full Course Tutorial](https://www.youtube.com/watch?v=cccadep8b9k) - Claude Code keeps forgetting your context — every session starts from scratch. In Episode 2 of this ...

9. [claude-code-best-practice/CLAUDE.md at main - GitHub](https://github.com/shanraisshan/claude-code-best-practice/blob/main/CLAUDE.md) - from vibe coding to agentic engineering - practice makes claude perfect - shanraisshan/claude-code-b...

10. [Best practices project structure (i.e. interplay between CLAUDE.md, agents, workflows, skills, MCP-servers, etc.)](https://www.reddit.com/r/ClaudeCode/comments/1qub3fm/best_practices_project_structure_ie_interplay/) - Best practices project structure (i.e. interplay between CLAUDE.md, agents, workflows, skills, MCP-s...

11. [SKILL.md vs CLAUDE.md vs AGENTS.md Compared | Termdock](https://www.termdock.com/blog/skill-md-vs-claude-md-vs-agents-md) - CLAUDE.md is project context for Claude Code. AGENTS.md is the same thing but cross-tool. SKILL.md i...

12. [Agent Skills - Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) - Skills are reusable, filesystem-based resources that provide Claude with domain-specific expertise: ...

13. [Agent Creating - Claude Skills](https://claude-plugins.dev/skills/@seanchiuai/claude-code-workflow/agent-creating) - Create new specialized agent. Use when user wants reusable agent for repetitive pattern. Examples: c...

14. [Implementing CLAUDE.md and Agent Skills In Your Repository](https://www.groff.dev/blog/implementing-claude-md-agent-skills) - A practical guide to the 3-tier documentation architecture that makes AI coding agents work: root CL...

15. [Skill authoring best practices - Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) - Good Skills are concise, well-structured, and tested with real usage. This guide provides practical ...

16. [Orchestrate subagents at scale with dynamic workflows](https://code.claude.com/docs/en/workflows)

17. [Build a proactive agent workflow with Claude Code](https://www.youtube.com/watch?v=eSP7PLTXNy8) - Routines turn Claude Code into a proactive teammate that reads your repo and opens a PR before you'v...

18. [Claude Code Workflow: Best Practices That Ship Code](https://dev.to/galian/claude-code-workflow-best-practices-that-ship-code-na) - Most posts about Claude Code stop at "install it and say hi." This guide goes further. A reliable...

19. [Claude Code Project Configuration Showcase - GitHub](https://github.com/ChrisWiles/claude-code-showcase) - Comprehensive Claude Code project configuration example with hooks, skills, agents, commands, and Gi...

20. [claude-code/plugins/plugin-dev/skills/plugin-structure/SKILL.md at ...](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/plugin-structure/SKILL.md) - Claude Code is an agentic coding tool that lives in your terminal, understands your codebase, and he...

