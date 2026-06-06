/**
 * System prompt construction - generic version.
 * No coding-specific defaults. Domain agents provide identity via customPrompt.
 */

import { formatSkillsForPrompt, type Skill } from "./skills.ts";

export interface BuildSystemPromptOptions {
	customPrompt?: string;
	selectedTools?: string[];
	toolSnippets?: Record<string, string>;
	promptGuidelines?: string[];
	appendSystemPrompt?: string;
	cwd: string;
	contextFiles?: Array<{ path: string; content: string }>;
	skills?: Skill[];
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
	} = options;
	const promptCwd = cwd.replace(/\\/g, "/");
	const date = new Date().toISOString().slice(0, 10);
	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";
	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	if (customPrompt) {
		let p = customPrompt;
		if (appendSection) p += appendSection;
		if (contextFiles.length > 0) {
			p += "\n\n<project_context>\n\nProject-specific instructions:\n\n";
			for (const { path: fp, content } of contextFiles) {
				p += `<project_instructions path="${fp}">\n${content}\n</project_instructions>\n\n`;
			}
			p += "</project_context>\n";
		}
		if (skills.length > 0) p += formatSkillsForPrompt(skills);
		p += `\nCurrent date: ${date}\nCurrent working directory: ${promptCwd}`;
		return p;
	}

	const tools = selectedTools ?? [];
	const visibleTools = tools.filter((n) => !!toolSnippets?.[n]);
	const toolsList =
		visibleTools.length > 0
			? visibleTools.map((n) => `- ${n}: ${toolSnippets![n]}`).join("\n")
			: "(none)";

	const guidelines = (promptGuidelines ?? [])
		.filter((g) => g.trim())
		.map((g) => `- ${g.trim()}`)
		.join("\n");

	let p = `You are an AI assistant. You help users complete tasks using the available tools.

Available tools:
${toolsList}
`;

	if (guidelines) {
		p += `\nGuidelines:\n${guidelines}\n`;
	}

	p +=
		"\nIn addition to the tools above, you may have access to other custom tools depending on the project.";

	if (appendSection) p += appendSection;

	if (contextFiles.length > 0) {
		p += "\n\n<project_context>\n\nProject-specific instructions:\n\n";
		for (const { path: fp, content } of contextFiles) {
			p += `<project_instructions path="${fp}">\n${content}\n</project_instructions>\n\n`;
		}
		p += "</project_context>\n";
	}

	if (skills.length > 0) p += formatSkillsForPrompt(skills);

	p += `\nCurrent date: ${date}\nCurrent working directory: ${promptCwd}`;

	return p;
}
