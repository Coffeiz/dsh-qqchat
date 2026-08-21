<div align="center">

# dsh-qqchat

### Bring QQ group and direct chats to DeepSeek Harness

<p>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/DSH-Plugin-6f42c1.svg" alt="DSH Plugin">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6.svg" alt="TypeScript">
</p>

<p>
  <a href="./README.md">中文</a> ·
  <a href="./docs/ARCHITECTURE.en.md">Architecture</a>
</p>

<p><em>Chat in QQ, then view the complete Session, memory and tool activity in DSH Web.</em></p>

`dsh-qqchat` is an official QQ Bot plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). It maps QQ groups and direct chats to ordinary DSH Sessions and uses DSH's native Conversation, Agent, command and tool surfaces.

> This is a Vibe Coding project, so code quality and engineering completeness may need improvement. If you find a problem or have a better implementation idea, please open an [Issue](https://github.com/Coffeiz/dsh-qqchat/issues) or submit a [Pull Request](https://github.com/Coffeiz/dsh-qqchat/pulls).

> This uses official QQ Bot authorization. It is not QR login for a personal QQ account.

</div>

## Features

| Feature | What it does | Notes |
| --- | --- | --- |
| QQ group and direct chat | Receives group and C2C messages | One isolated DSH Session per group or direct peer |
| QR connection | Binds an official QQ Bot from **Settings -> QQ Chat** | Cancel the binding and scan again when needed |
| Group receive modes | Auto reply, Mention only or Silent record | Silent record stores messages without waking the Agent |
| Message formats | Smart, Markdown or Plain compatibility | Group and direct-chat formats are configured separately; groups default to Plain compatibility |
| Direct-chat streaming | Optionally uses QQ's official streaming message API for private chats | Private chats only; Plain compatibility disables it automatically; some clients may not display streaming |
| Quotes and mentions | Preserves quoted messages and resolves QQ mentions to display names | Stable IDs remain in metadata |
| Memory system | Stores group, member and direct-user memory | Can be disabled; disabling does not delete existing memory |
| Memory reflection | Converts recent daily notes into long-term memory | Runs asynchronously after idle or batch thresholds |
| Media and file permissions | Separately controls receiving media, reading attachments, and regular tools | Owner and direct chats are unrestricted by default |
| Tool permissions | Separately controls whether group members may use regular Agent tools | Owner is matched by stable user ID |
| Native DSH commands | Runs `/compact`, `/goal`, `/plan`, `/qqmodel`, `/qqstatus` and more directly from QQ | Commands do not go through the model; `/qqhelp` lists the full set |
| Native DSH UI | Uses the normal Session list, Conversation surface and composer styling | QQ Sessions remain ungrouped in DSH |
| Diagnostics | Shows plugin logs in Settings | Useful for connection and delivery troubleshooting |

## How to use

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/assets/扫码链接.jpg" width="100%" alt="QQ Chat QR connection">
      <h3>Scan to connect</h3>
      <p>Open <strong>Settings -> QQ Chat</strong> in DSH Web and scan the generated QR code with QQ to authorize an official Bot. Connection status, QR regeneration and cancellation are all available on the same page.</p>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/assets/设置界面.jpg" width="100%" alt="QQ Chat settings page">
      <h3>Settings and permissions</h3>
      <p>Use the settings page to configure group receive mode, message formats, memory, media and file access, tool permissions and the Owner account.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/assets/群聊界面.jpg" width="100%" alt="QQ group chat in DSH Web">
      <h3>Group and direct chat</h3>
      <p>QQ groups and direct chats connect to the DSH Agent and appear as separate Sessions. Groups support auto reply, mention-only reply and silent recording, as well as quoted messages, username display and mention conversion.</p>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/assets/记忆系统.jpg" width="100%" alt="QQ Chat memory system">
      <h3>Memory system</h3>
      <p>The plugin maintains separate memory for groups, members and direct users. Member memory supports profiles, group nicknames, historical nicknames, behavior patterns and long-term notes; recent messages are organized asynchronously. Memory is refreshed as Session context when needed, and can be disabled without deleting stored data.</p>
    </td>
  </tr>
</table>

### Scan to connect

1. Start DSH.
2. Open **Settings -> QQ Chat**.
3. Choose **Scan to connect** and scan the QR code with QQ.
4. Authorize the desired official Bot.
5. The Gateway starts automatically. Use **Cancel connection** before scanning again if you need to bind another Bot.

The Host decrypts and stores the AppSecret in the local plugin database. The temporary QR AES key never travels through the browser Client RPC.

### Chat in QQ

QQ groups and direct chats appear as normal DSH Sessions. Group messages can be handled automatically, only when the Bot is mentioned, or recorded silently. Quotes are preserved, and `@` mentions are displayed with the resolved username whenever QQ provides one.

### Use the memory system

The plugin keeps separate memory for groups, members and direct users. Member profiles support typed facts, group nicknames, historical nicknames, patterns, summaries and long-term notes. Daily records use one `## YYYY-MM-DD` heading per day and are asynchronously reflected into long-term memory.

Memory is injected through DSH's official runtime-context snapshot mechanism, so a new snapshot replaces the previous one instead of accumulating duplicate full contexts. Memory is enabled by default and can be switched off under **Settings -> QQ Chat -> Memory system**. The setting warns that memory may reduce context-cache hit rate and increase input tokens; disabling it stops injection and background reflection without deleting stored data.

## Install

### New `qqchat` profile

Install the official DSH Web bundle together with the plugin:

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app dsh-qqchat
npx @deepseek-ai/dsh --profile qqchat
```

### Existing Web profile

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-qqchat
npx @deepseek-ai/dsh --profile web
```

### Development branch

Before npm publication, install the branch directly from GitHub:

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app "git+ssh://git@github.com/Coffeiz/dsh-qqchat.git#agent/typescript-migration"
npx @deepseek-ai/dsh --profile qqchat
```

Git installs build TypeScript through `prepare`. For local development:

```bash
git clone git@github.com:Coffeiz/dsh-qqchat.git
cd dsh-qqchat
npm install
npm run check
```

## Group receive modes

Configure **Settings -> QQ Chat -> Message reception**:

| Mode | Behavior |
| --- | --- |
| Auto reply | Every group message can trigger the Agent |
| Mention only | All messages are stored, but only messages mentioning the Bot trigger a reply |
| Silent record | Stores messages and memory without actively replying |

Groups default to Plain compatibility format. Group and direct-chat formats can be selected independently. Plain compatibility for direct chats automatically disables streaming.

## Commands

Messages beginning with `/` are handled directly by the command system and are not sent to the model. Native DSH commands keep their original names; QQChat commands use the `qq` prefix. In a group, write `@Bot /help` or `@Bot /qqhelp`.

| Command | Purpose |
| --- | --- |
| `/qqhelp`, `/qqcommands` | List QQChat and DSH commands |
| `/qqnew`, `/qqreset`, `/qqclear` | Keep the old Session and start a new one on the next message |
| `/compact` | Compact older conversation history |
| `/qqmodel [provider/]model` | Show or switch the current Session model |
| `/qqstop` | Stop the current generation |
| `/qqstatus` | Show Session, model and generation status |
| `/qqping` | Check QQChat connectivity |
| `/qqversion` | Show the plugin version |
| `/goal` | Manage a DSH Goal |
| `/plan` | Enter or leave Plan mode |
| `/feedback` | Submit feedback |
| `/permission` | View or switch tool permission presets |

### Where `/feedback` goes

`/feedback` uses DSH's native feedback mechanism. It does not create a GitHub Issue or send feedback directly to the QQChat authors. By default, feedback is written only to the current DSH Session's local log and does not leave the machine.

It is uploaded to a configured OTLP service only when DSH session telemetry is explicitly enabled:

| DSH telemetry mode | Destination |
| --- | --- |
| `DISABLED` (default) | Local DSH Session only |
| `FEEDBACK_ONLY` | The current Session log suffix is sent to the configured OTLP service when `/feedback` is recorded |
| `FULL` | Session events are sent to the configured OTLP service in real time; `/feedback` also records a feedback event |

Feedback may include the current Session's conversation, tool arguments, tool results and workspace path. Check your DSH telemetry settings before submitting sensitive information.

`/export` is a browser-only DSH Web command and is not available from QQ. Model changes apply independently to each group or direct Session while preserving the existing conversation.

## Memory content

QQ Chat stores:

- Group memory: important events, agreements, topics and relationships.
- Member memory: profile facts, group nicknames, historical nicknames, behavior patterns and long-term information.
- Direct-chat memory: long-term information about a direct QQ user.

Reflection runs asynchronously after the chat is idle or enough messages have accumulated. The **QQ Memory** action at the top of a QQ Session shows group and member memory. Memory snapshots refresh when a Session starts, the memory context expires, or the Session is compacted; continuous conversation does not repeatedly write the full memory. Enabled memory may reduce context-cache hit rate or increase input tokens, and can be disabled under **Settings -> QQ Chat -> Memory system** without deleting stored data.

## Tool permissions

When **Group members can use tools** is enabled, group-triggered Agent turns may use the tools exposed by the current preset. When disabled, only the configured Owner stable ID may execute tools; other group members can still chat normally.

Owner matching uses a stable QQ user ID, not a nickname.

## Message display

QQ conversations use DSH's default Conversation UI:

- Sender usernames are displayed without exposing stable IDs in the bubble.
- Own and other people's messages use the native DSH bubble alignment.
- Quoted messages are displayed.
- QQ `@` mentions are converted to usernames when available.
- The DSH Session composer can proactively send messages to QQ.

## Notes

- An official QQ Bot is required; personal QQ account login is not supported.
- `0.2.0` is still being refined; test with a dedicated Bot and group first.
- Rich media, full QQ emoji handling and some complex message formats may require compatibility mode.
- Uninstalling the plugin does not automatically delete saved chat or memory data.

## Settings

The Settings page contains configuration only:

```text
QR authorization and connection
Group receive mode
Group and direct-chat reply formats
Memory system [on/off]
Media and file permissions and regular tool permissions are independent settings:

- **Receive group-member media/files** controls whether images, files, audio, and video are downloaded, stored, and shown in the session.
- **Allow group members to read media/files** controls whether their Agent turns may call QQChat media tools for the current attachment.
- **Group members can use tools** controls access to regular Agent tools.
Owner stable ID
Diagnostics and logs
```

The Settings page does not contain chat lists, transcripts or memory browsing. Those remain in the normal DSH Session and Conversation surfaces.

## Persistence and memory scopes

The SQLite database is stored at:

```text
$DSH_HOME/plugins/dsh-qqchat/qqchat.sqlite
```

SQLite is the source of truth for real QQ history, identities, settings, memory documents and the proactive-message outbox. DSH Sessions store the Agent turns, model output, tools, titles and visible transcript events.

Memory scopes are isolated as follows:

- **Group:** profile, summary, daily and long-term memory for one QQ group.
- **Member:** typed profile, pattern, summary, daily and long-term memory for one stable sender.
- **Direct chat:** uses the member scope for that QQ user.

The same stable sender may retain member memory across groups under the same Bot. Group relationships and group-specific facts never cross group scopes. Reflection runs after roughly 120 seconds of inactivity or 20 unreflected messages, and can also compress older daily records after the configured thresholds.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run check
```

The source layout follows feature boundaries:

```text
src/config.ts             runtime configuration
src/gateway/              QQ API, authorization, Gateway and normalization
src/session/              Agent bridge and QQ runtime
src/storage/              SQLite and memory engine
src/transport/            Client RPC
src/commands/             QQ command dispatch
src/shared/               shared augmentations and logging
client-src/               DSH Web Client factory and settings UI
tests/                    automated tests
```

See [docs/ARCHITECTURE.en.md](./docs/ARCHITECTURE.en.md) for the detailed boundaries and data flow.

## License

This project is released under the [MIT License](./LICENSE).
