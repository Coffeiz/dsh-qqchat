# Session Data Migrations

[English](./SESSION_MIGRATIONS.en.md) | [简体中文](./SESSION_MIGRATIONS.md)

## Overview

After dsh-qqchat is upgraded, startup checks the QQChat Sessions visible to the active DSH profile and migrates legacy passive-message records. The migration converts only `qqchat/message` display events. It does not change Agent conversation content, Session IDs, or QQChat's SQLite history.

Passive messages are stored as ignorable `plugin:qqchat/message` records after migration. DSH can safely retain and skip records it does not recognize; the plugin Client renders them when loaded.

## Migration flow

The [startup migration entry](../src/migrations/index.ts) registers and runs migrations in order; the current step lives in [qqchat-display-events.ts](../src/migrations/qqchat-display-events.ts). It first uses the public Session Persistence `list` API to discover the actual storage root, then scans every `qqchat-*` Session directory there. Upgrading older generations uses the public `open` and `stat` APIs and handles each source generation as follows:

| Source format | Handling |
| --- | --- |
| v4 | Rename the legacy event to `plugin:qqchat/message` and mark it `ignorable: true` |
| v3 | Mark the old event ignorable, then use DSH's write-open path to publish the current format; DSH namespaces the event |
| v0–v2 | Temporarily convert it to a feedback record that does not affect the conversation surface, use DSH's official format migrator, then restore it as a plugin record |

Sessions migrate one at a time. Before replacing a log, the migration creates a full backup in the same directory, writes and validates a temporary file, checks the header and event order, then atomically replaces the selected generation. v0-v2 records predate event sequence numbers; DSH's official migrator assigns the current sequence. v3 and later records are checked for contiguous sequences. The migration also removes QQ-specific source fields written by older plugin versions from `user/message` and queued message metadata; display information remains in the plugin records.

Older plugin versions could write duplicate `user/message` surface records with `source.channel=qq` before `step/start`. The migration recognizes only those QQ records and temporarily stores them as feedback placeholders. After DSH's official migrator succeeds, it restores them as ignorable QQ bubble events and retains the original message payload. This avoids reordering DSH conversation events and does not replay the old QQ messages as model input. Pre-head surface records from other sources are left untouched and counted as deferred. Other failed upgrades roll back the current staging and retain the backup for a later plugin version. A marker in each Session directory makes later startups skip completed Sessions.

## Scope and recovery

- Only persisted Sessions whose IDs start with `qqchat-` are considered, and only the generation currently selected by DSH is migrated.
- Older immutable generations are not rewritten directly. DSH's normal format migration creates the current generation, and each replaced source file remains backed up.
- Migration logs contain only Session IDs, counts, and failure reasons. They never contain message bodies, attachment names, or credentials.
- A failed migration does not prevent the plugin from starting. No completion marker is written for the failed Session, so a later startup retries it.
- Do not manually run or copy migration files while DSH is writing the same Sessions. The plugin migration runs during Host startup, before the QQ Gateway starts.

Legacy `qqchat/message` events were required custom event types, so DSH refused to load the entire Session. After migration, Web can read the full history. The original files remain available in their backups for manual recovery or another migration attempt.
