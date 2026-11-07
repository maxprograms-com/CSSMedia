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

import type { Block, CssNode, Declaration as CssTreeDeclaration, List, MediaQueryList, SelectorList } from "css-tree";
import { generate, parse } from "css-tree";
import { FontSupport } from "../fonts/FontSupport.js";
import { AsciiCase } from "./AsciiCase.js";
import type { ConditionEvaluator } from "./ConditionEvaluator.js";
import type { DeclarationReader } from "./DeclarationReader.js";
import type { SelectorCompiler } from "./SelectorCompiler.js";
import { SelectorText } from "./SelectorText.js";

const SUPPORTED_AT_RULES: ReadonlySet<string> = new Set<string>([
    "import", "namespace", "media", "supports", "supports-condition", "layer", "page", "font-face", "font-feature-values", "font-palette-values",
    "counter-style", "property", "custom-media", "when", "else", "container", "scope", "function", "position-try", "color-profile",
    "top-left-corner", "top-left", "top-center", "top-right", "top-right-corner", "right-top", "right-middle", "right-bottom",
    "bottom-right-corner", "bottom-right", "bottom-center", "bottom-left", "bottom-left-corner", "left-bottom", "left-middle", "left-top",
    "footnote", "stylistic", "historical-forms", "styleset", "character-variant", "swash", "ornaments", "annotation"
]);

export class SupportsEvaluator {

    private readonly declarations: DeclarationReader;
    private readonly selectors: SelectorCompiler;
    private readonly media: ConditionEvaluator;
    private readonly named: Map<string, boolean> = new Map<string, boolean>();
    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly fonts: FontSupport = new FontSupport();
    private readonly selectorText: SelectorText = new SelectorText();

    constructor(declarations: DeclarationReader, selectors: SelectorCompiler, media: ConditionEvaluator) {
        this.declarations = declarations;
        this.selectors = selectors;
        this.media = media;
    }

    define(name: string, block: Block, namespaces: ReadonlyMap<string, string>): void {
        // CSS Conditional 5 §8: a named condition holds when everything in its block is supported, and the last definition wins.
        let supported: boolean = true;
        for (const child of block.children) {
            if (child.type === "Declaration") {
                supported = supported && this.declarations.isValid(child);
            } else if (child.type === "Rule") {
                const list: SelectorList | undefined = child.prelude.type === "SelectorList" ? child.prelude
                    : (child.prelude.type === "Raw" ? this.selectorText.parseList(child.prelude.value) : undefined);
                supported = supported && list !== undefined && this.compiles(list, namespaces);
            } else if (child.type === "Atrule") {
                supported = supported && SUPPORTED_AT_RULES.has(this.asciiCase.foldLower(child.name));
            } else {
                supported = false;
            }
        }
        this.named.set(name, supported);
    }

    defineResult(name: string, supported: boolean): void {
        this.named.set(name, supported);
    }

    definitions(): Array<[string, boolean]> {
        return [...this.named];
    }

    holds(text: string, namespaces: ReadonlyMap<string, string>): boolean {
        // CSS Values 5 §7.3: supports( [ <ident> : <declaration-value> ] | <supports-condition> ).
        try {
            if (/^\s*-?[A-Za-z_\u0080-￿-][\w\u0080-￿-]*\s*:/.test(text)) {
                return this.declarations.isValid(parse(text, { context: "declaration" }) as CssTreeDeclaration);
            }
            const sheet: CssNode = parse("@supports " + text + " {}");
            const rule: CssNode | null = sheet.type === "StyleSheet" ? sheet.children.first : null;
            const condition: CssNode | null = rule !== null && rule.type === "Atrule" && rule.prelude !== null && rule.prelude.type === "AtrulePrelude" ? rule.prelude.children.first : null;
            return condition !== null && this.supports(condition, namespaces);
        } catch {
            return false;
        }
    }

    supports(node: CssNode, namespaces: ReadonlyMap<string, string>): boolean {
        // CSS Conditional 3 §6 and 5 §2: declarations, selector(), font-tech(), font-format(), at-rule() and named conditions.
        switch (node.type) {
            case "Condition":
                return this.condition(node.children.toArray(), (child: CssNode) => this.supports(child, namespaces));
            case "SupportsDeclaration":
                return this.declarations.isValid(node.declaration as CssTreeDeclaration);
            case "Declaration":
                return this.declarations.isValid(node);
            case "Identifier":
                return node.name.startsWith("--") && this.named.get(node.name) === true;
            case "FeatureFunction": {
                // A selector() whose selector does not parse arrives as raw text.
                const value: CssNode = node.value as CssNode;
                if (this.asciiCase.foldLower(node.feature) !== "selector") {
                    return false;
                }
                return value.type === "Raw" ? this.selectorSupported(value.value, namespaces) : value.type === "Selector" && this.selectors.compile(value, namespaces) !== undefined;
            }
            case "GeneralEnclosed":
                return node.function !== null && this.feature(node.function, this.argumentText(node.children));
            case "Function":
                return this.feature(node.name, this.argumentText(node.children));
            default:
                return false;
        }
    }

    when(text: string, namespaces: ReadonlyMap<string, string>): boolean {
        // CSS Conditional 5 §3: a boolean condition over media() and supports() leaves, and the other supports functions.
        // The value context of css-tree cannot read the colon of a declaration inside a function; the @supports prelude keeps it.
        let condition: CssNode | null;
        try {
            const sheet: CssNode = parse("@supports " + text + " {}");
            const rule: CssNode | null = sheet.type === "StyleSheet" ? sheet.children.first : null;
            condition = rule !== null && rule.type === "Atrule" && rule.prelude !== null && rule.prelude.type === "AtrulePrelude" ? rule.prelude.children.first : null;
        } catch {
            return false;
        }
        return condition !== null && this.whenLeaf(condition, namespaces);
    }

    private whenLeaf(node: CssNode, namespaces: ReadonlyMap<string, string>): boolean {
        if (node.type === "Condition") {
            return this.condition(node.children.toArray(), (child: CssNode) => this.whenLeaf(child, namespaces));
        }
        if (node.type === "FeatureFunction") {
            return this.supports(node, namespaces);
        }
        if (node.type !== "GeneralEnclosed" || node.function === null) {
            return false;
        }
        const name: string = this.asciiCase.foldLower(node.function);
        const argument: string = this.argumentText(node.children);
        if (name === "media") {
            const list: MediaQueryList | null = this.mediaList("(" + argument + ")");
            return list !== null && this.media.matchesList(list);
        }
        if (name === "supports") {
            try {
                return this.declarations.isValid(parse(argument, { context: "declaration" }) as CssTreeDeclaration);
            } catch {
                return false;
            }
        }
        return this.feature(name, argument);
    }

    private selectorSupported(text: string, namespaces: ReadonlyMap<string, string>): boolean {
        // CSS Conditional 4 §2: selector() takes one complex selector.
        const list: SelectorList | undefined = this.selectorText.parseList(text);
        return list !== undefined && list.children.size === 1 && this.compiles(list, namespaces);
    }

    private compiles(list: SelectorList, namespaces: ReadonlyMap<string, string>): boolean {
        return list.children.toArray().every((selector: CssNode) => selector.type === "Selector" && this.selectors.compile(selector, namespaces) !== undefined);
    }

    private feature(rawName: string, argument: string): boolean {
        // CSS Conditional 5 §2.1: a font format or technology is supported when CSSMedia can use it in layout and rendering.
        const name: string = this.asciiCase.foldLower(rawName);
        const value: string = this.asciiCase.foldLower(argument.trim());
        switch (name) {
            case "font-format":
                return this.fonts.format(value);
            case "font-tech":
                return this.fonts.technology(value);
            case "at-rule":
                return value.startsWith("@") && SUPPORTED_AT_RULES.has(value.substring(1));
            default:
                return false;
        }
    }

    private condition(children: ReadonlyArray<CssNode>, leaf: (node: CssNode) => boolean): boolean {
        if (children.length === 2 && children[0].type === "Identifier" && this.asciiCase.foldLower(children[0].name) === "not") {
            return !leaf(children[1]);
        }
        const operands: Array<CssNode> = children.filter((child: CssNode) => !(child.type === "Identifier" && ["and", "or"].includes(this.asciiCase.foldLower(child.name))));
        const any: boolean = children.some((child: CssNode) => child.type === "Identifier" && this.asciiCase.foldLower(child.name) === "or");
        if (operands.length === 0) {
            return false;
        }
        return any ? operands.some((child: CssNode) => leaf(child)) : operands.every((child: CssNode) => leaf(child));
    }

    private argumentText(children: List<CssNode>): string {
        return generate({ type: "Value", children } as CssNode);
    }

    private mediaList(text: string): MediaQueryList | null {
        try {
            const list: CssNode = parse(text, { context: "mediaQueryList" });
            return list.type === "MediaQueryList" ? list : null;
        } catch {
            return null;
        }
    }
}
