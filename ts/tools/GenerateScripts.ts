/*******************************************************************************
 * Copyright (c) 2026 Maxprograms. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * Change Date: 2030-11-01
 * Change License: Mozilla Public License, v. 2.0
 *
 * Additional Use Grant:
 * You may make production use of the Licensed Work for personal use,
 * educational use, and academic research. "Personal use" means use by an
 * individual for their own purposes, and not on behalf of an employer, client
 * or other organization. You may also make production use of the Licensed Work
 * for trial purposes for a period of up to 30 days.
 *
 * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html
 * or in the LICENSE file provided in the root of this repository.
 *******************************************************************************/

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const UCD_URL: string = "https://www.unicode.org/Public/UCD/latest/ucd/";
const REGISTRY_URL: string = "https://learn.microsoft.com/en-us/typography/opentype/spec/scripttags";
const RANGE: RegExp = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*([^#]+?)\s*(?:#|$)/;
const ALIAS: RegExp = /^sc\s*;\s*(\w+)\s*;\s*(\w+)/;
const REGISTRY_ROW: RegExp = /<tr>\s*<td>(.*?)<\/td>\s*<td>'(.*?)'<\/td>/gs;
const NO_BREAK_SPACE: string = '\u00A0';
const SECOND_VERSION: string = " v.2";
const UNKNOWN: string = "Zzzz";
const JOINING_TYPES: ReadonlySet<string> = new Set<string>(["D", "L", "R"]);

interface CodeRange {
    start: number;
    end: number;
    value: string;
}

interface RegisteredScript {
    name: string;
    tag: string;
}

interface Script {
    code: string;
    name: string;
    tags: Array<string>;
    joining: boolean;
}

class ScriptGenerator {

    private readonly outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
    }

    async run(): Promise<void> {
        const names: Map<string, string> = this.aliases(await this.fetchText(UCD_URL + "PropertyValueAliases.txt"));
        const ranges: Array<CodeRange> = this.ranges(await this.fetchText(UCD_URL + "Scripts.txt"));
        const extensions: Array<CodeRange> = this.ranges(await this.fetchText(UCD_URL + "ScriptExtensions.txt"));
        const joining: Array<CodeRange> = this.ranges(await this.fetchText(UCD_URL + "extracted/DerivedJoiningType.txt"));
        const registry: Array<RegisteredScript> = this.registry(await this.fetchText(REGISTRY_URL));
        const codes: Map<string, string> = new Map<string, string>([...names].map((entry: [string, string]): [string, string] => [entry[1], entry[0]]));
        const coded: Array<CodeRange> = ranges.map((range: CodeRange) => ({ start: range.start, end: range.end, value: codes.get(range.value) ?? UNKNOWN }));
        const joiningScripts: Set<string> = this.joiningScripts(coded, joining);
        // Scripts.txt: "All code points not explicitly listed for Script have the value Unknown (Zzzz)", which takes index 0.
        const scripts: Array<Script> = [UNKNOWN, ...[...names.keys()].filter((code: string) => code !== UNKNOWN).sort()].map((code: string) => ({
            code, name: names.get(code) ?? "", tags: this.tagsOf(code, names.get(code) ?? "", registry), joining: joiningScripts.has(code)
        }));
        console.log("Read " + scripts.length + " scripts, " + coded.length + " ranges and " + registry.length + " registered script tags");
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(scripts, this.merged(coded), extensions), "utf8");
    }

    private async fetchText(url: string): Promise<string> {
        const response: Response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch " + url + ": " + response.status + " " + response.statusText);
        }
        return response.text();
    }

    private aliases(text: string): Map<string, string> {
        const names: Map<string, string> = new Map<string, string>();
        for (const line of text.split("\n")) {
            const match: RegExpExecArray | null = ALIAS.exec(line);
            if (match !== null) {
                names.set(match[1], match[2]);
            }
        }
        return names;
    }

    private ranges(text: string): Array<CodeRange> {
        const ranges: Array<CodeRange> = [];
        for (const line of text.split("\n")) {
            const match: RegExpExecArray | null = RANGE.exec(line);
            if (match !== null) {
                ranges.push({ start: Number.parseInt(match[1], 16), end: Number.parseInt(match[2] ?? match[1], 16), value: match[3] });
            }
        }
        return ranges.sort((first: CodeRange, second: CodeRange) => first.start - second.start);
    }

    private merged(ranges: ReadonlyArray<CodeRange>): Array<CodeRange> {
        const result: Array<CodeRange> = [];
        for (const range of ranges) {
            const last: CodeRange | undefined = result[result.length - 1];
            if (last !== undefined && last.value === range.value && last.end + 1 === range.start) {
                last.end = range.end;
            } else {
                result.push({ ...range });
            }
        }
        return result;
    }

    private registry(html: string): Array<RegisteredScript> {
        const registered: Array<RegisteredScript> = [];
        for (const match of html.matchAll(REGISTRY_ROW)) {
            const name: string = match[1].replace(/<[^>]*>/g, "").trim();
            const tag: string = match[2].replace(/&nbsp;/g, " ").replaceAll(NO_BREAK_SPACE, " ");
            if (tag.length === 4) {
                registered.push({ name, tag });
            }
        }
        return registered;
    }

    private tagsOf(code: string, name: string, registry: ReadonlyArray<RegisteredScript>): Array<string> {
        // OpenType script tags: the tags "are not guaranteed to be the same as" the ISO 15924 codes. The tag is the code in
        // lowercase when registered, or a shorter registered tag padded with spaces, or the tag registered under the name.
        const lower: string = code.toLowerCase();
        const spoken: string = name.replace(/_/g, " ").toLowerCase();
        const entry: RegisteredScript | undefined = registry.find((candidate: RegisteredScript) => candidate.tag === lower)
            ?? registry.find((candidate: RegisteredScript) => candidate.tag.endsWith(" ") && lower.startsWith(candidate.tag.trim()))
            ?? registry.find((candidate: RegisteredScript) => candidate.name.toLowerCase() === spoken);
        if (entry === undefined) {
            return [];
        }
        // A script whose shaping model was revised has a second tag, registered as the name followed by "v.2", which comes first.
        const second: RegisteredScript | undefined = registry.find((candidate: RegisteredScript) =>
            candidate.name.endsWith(SECOND_VERSION) && entry.name.startsWith(candidate.name.slice(0, -SECOND_VERSION.length)));
        return second === undefined ? [entry.tag] : [second.tag, entry.tag];
    }

    private joiningScripts(scripts: ReadonlyArray<CodeRange>, joining: ReadonlyArray<CodeRange>): Set<string> {
        // A script joins cursively when one of its characters has the joining type Dual_Joining, Left_Joining or Right_Joining.
        const result: Set<string> = new Set<string>();
        for (const range of joining) {
            if (!JOINING_TYPES.has(range.value)) {
                continue;
            }
            for (const script of scripts) {
                if (script.start <= range.end && script.end >= range.start) {
                    result.add(script.value);
                }
            }
        }
        return result;
    }

    private render(scripts: ReadonlyArray<Script>, ranges: ReadonlyArray<CodeRange>, extensions: ReadonlyArray<CodeRange>): string {
        const header: string =
            "/*******************************************************************************\n" +
            " * Copyright (c) 2026 Maxprograms. All rights reserved.\n" +
            " *\n" +
            " * Licensed under the Business Source License 1.1 (the \"License\");\n" +
            " * you may not use this file except in compliance with the License.\n" +
            " *\n" +
            " * Change Date: 2030-11-01\n" +
            " * Change License: Mozilla Public License, v. 2.0\n" +
            " *\n" +
            " * Additional Use Grant:\n" +
            " * You may make production use of the Licensed Work for personal use,\n" +
            " * educational use, and academic research. \"Personal use\" means use by an\n" +
            " * individual for their own purposes, and not on behalf of an employer, client\n" +
            " * or other organization. You may also make production use of the Licensed Work\n" +
            " * for trial purposes for a period of up to 30 days.\n" +
            " *\n" +
            " * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html\n" +
            " * or in the LICENSE file provided in the root of this repository.\n" +
            " *******************************************************************************/\n\n";
        const indexes: Map<string, number> = new Map<string, number>(scripts.map((script: Script, index: number): [string, number] => [script.code, index]));
        const scriptRows: Array<string> = scripts.map((script: Script) =>
            "    [\"" + script.code + "\", [" + script.tags.map((tag: string) => "\"" + tag + "\"").join(", ") + "], " + script.joining + "]");
        const rangeRows: Array<string> = ranges.filter((range: CodeRange) => range.value !== UNKNOWN).map((range: CodeRange) =>
            "    [0x" + this.hex(range.start) + ", 0x" + this.hex(range.end) + ", " + indexes.get(range.value) + "]");
        const extensionRows: Array<string> = extensions.map((range: CodeRange) =>
            "    [0x" + this.hex(range.start) + ", 0x" + this.hex(range.end) + ", ["
            + range.value.split(/\s+/).map((code: string) => indexes.get(code) ?? 0).join(", ") + "]]");
        return header
            + "export const SCRIPTS: ReadonlyArray<readonly [string, ReadonlyArray<string>, boolean]> = [\n" + scriptRows.join(",\n") + "\n];\n\n"
            + "export const SCRIPT_RANGES: ReadonlyArray<readonly [number, number, number]> = [\n" + rangeRows.join(",\n") + "\n];\n\n"
            + "export const SCRIPT_EXTENSIONS: ReadonlyArray<readonly [number, number, ReadonlyArray<number>]> = [\n" + extensionRows.join(",\n") + "\n];\n";
    }

    private hex(code: number): string {
        return code.toString(16).toUpperCase();
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new ScriptGenerator(join(PACKAGE_ROOT, "ts", "fonts", "generated", "Scripts.ts")).run();
    console.log("Generated ts/fonts/generated/Scripts.ts");
} catch (error) {
    console.error("Error generating the script tables:", error);
    process.exitCode = 1;
}
