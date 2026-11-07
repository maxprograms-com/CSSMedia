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

import type { CssNode, Declaration as CssTreeDeclaration, Selector } from "css-tree";
import { parse } from "css-tree";
import type { CompiledSelector } from "../css/CompiledSelector.js";
import { DeclarationReader } from "../css/DeclarationReader.js";
import type { PropertyTable } from "../css/PropertyTable.js";
import { SelectorCompiler } from "../css/SelectorCompiler.js";
import type { Declaration, StyleRule } from "../css/Stylesheet.js";
import { SourceDOMBuilder } from "../parse/SourceDOMBuilder.js";

const BASE_URL: string = "about:blank";
const NAMESPACES: ReadonlyMap<string, string> = new Map<string, string>([["xml", SourceDOMBuilder.XML_NAMESPACE]]);

export class UserAgentRules {

    private readonly reader: DeclarationReader;
    private readonly compiler: SelectorCompiler = new SelectorCompiler();

    constructor(table: PropertyTable) {
        this.reader = new DeclarationReader(table);
    }

    styleRules(): Array<StyleRule> {
        // CSS Lists 3 §3.1.1: UAs must add the first rule to their default style sheet. XML 1.0 §2.10: xml:space="preserve"
        // asks that white space be preserved in the element and its content, and "default" brings the default processing back.
        const rules: Array<StyleRule> = [
            this.rule("::marker, ::before::marker, ::after::marker", "unicode-bidi: isolate; font-variant-numeric: tabular-nums; white-space: pre; text-transform: none", 0),
            this.rule("[xml|space=\"preserve\"]", "white-space-collapse: preserve", 1),
            this.rule("[xml|space=\"default\"]", "white-space-collapse: collapse", 2)
        ];
        // GCPM 3 §2.6: the call is by default "the value of the footnote counter, styled as a superscripted number"; §2.7: the
        // marker's "default style should include list-style-position: inside", and its default text ends with ". ".
        rules.push(this.rule("::footnote-call", "content: counter(footnote); font-variant-position: super", 3));
        rules.push(this.rule("::footnote-marker", "content: counter(footnote) \". \"; list-style-position: inside", 4));
        return rules;
    }

    rule(selectors: string, declarations: string, order: number, namespaces: ReadonlyMap<string, string> = NAMESPACES): StyleRule {
        const compiled: Array<CompiledSelector> = [];
        const selectorList: CssNode = parse(selectors, { context: "selectorList" });
        if (selectorList.type !== "SelectorList") {
            throw new Error("The user agent selector list " + selectors + " is not valid");
        }
        for (const selector of selectorList.children.toArray()) {
            const result: CompiledSelector | undefined = selector.type === "Selector" ? this.compiler.compile(selector as Selector, namespaces) : undefined;
            if (result === undefined) {
                throw new Error("The user agent selector list " + selectors + " is not valid");
            }
            compiled.push(result);
        }
        const read: Array<Declaration> = [];
        const list: CssNode = parse(declarations, { context: "declarationList" });
        if (list.type === "DeclarationList") {
            for (const node of list.children) {
                const declared: Array<Declaration> | undefined = node.type === "Declaration"
                    ? this.reader.read(node as CssTreeDeclaration, BASE_URL, DeclarationReader.NO_NAMESPACES) : undefined;
                if (declared !== undefined) {
                    read.push(...declared);
                }
            }
        }
        return { kind: "style", selectors: compiled, declarations: read, containers: [], layer: 0, order };
    }
}
