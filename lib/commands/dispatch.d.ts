import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CommandRuntime } from '@deepseek-ai/dsh-commands';
export interface QQCommandReply {
    handled: boolean;
    text?: string;
}
export interface QQCommandScope {
    chatType: 'group' | 'c2c';
    isOwner: boolean;
}
/** Normalize a QQ command that may be prefixed by the bot mention. */
export declare function qqCommandText(text: string, mentioned: boolean): string | undefined;
/** Return the command name from a complete slash-command line. */
export declare function slashCommandName(input: string): string | undefined;
/** Dispatch one QQ slash command through DSH's native command registry. */
export declare function dispatchQQCommand(commands: CommandRuntime, agent: Agent, input: string, scope?: QQCommandScope): Promise<QQCommandReply>;
