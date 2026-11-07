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

import type { XMLNode } from "typesxml";
import { TextNode } from "typesxml";
import { AnPlusBParser } from "../css/AnPlusBParser.js";
import { AsciiCase } from "../css/AsciiCase.js";
import { LanguageUtils } from "typesbcp47";
import type {
    AttributeMatcher, Combinator, CompiledSelectorStep, CompoundSelector, Direction, NamespaceConstraint, NthMatcher, ReferenceAttribute, RelativeSelector
} from "../css/CompiledSelector.js";
import { SelectorCompiler } from "../css/SelectorCompiler.js";
import { SourceElement } from "../parse/SourceElement.js";
import { LanguageRangeMatcher } from "./LanguageRangeMatcher.js";
import type { LanguageResolver } from "./LanguageResolver.js";
import type { LinkResolver } from "./LinkResolver.js";
import type { TableColumns } from "./TableColumns.js";
import { UnicodeBidi } from "./UnicodeBidi.js";

export type ScopingRoot = SourceElement | "document" | undefined;

export class SelectorMatcher {

    static readonly LIST_SEPARATOR: RegExp = /[ \t\r\n\f]+/;
    static readonly ID_ATTRIBUTES: ReadonlyArray<string> = ["id", "xml:id"];
    static readonly WHITESPACE_ONLY: RegExp = /^[ \t\r\n]*$/;

    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly anPlusB: AnPlusBParser = new AnPlusBParser();
    private readonly ranges: LanguageRangeMatcher = new LanguageRangeMatcher();
    private readonly siblings: WeakMap<SourceElement, ReadonlyArray<SourceElement>> = new WeakMap<SourceElement, ReadonlyArray<SourceElement>>();
    private readonly positions: WeakMap<SourceElement, number> = new WeakMap<SourceElement, number>();
    private readonly root: SourceElement;
    private readonly prefixes: ReadonlyMap<string, string>;
    private readonly prefixed: boolean;
    private readonly rootNamespace?: string;
    private readonly directions: WeakMap<SourceElement, Direction> = new WeakMap<SourceElement, Direction>();
    private readonly bidi: UnicodeBidi = new UnicodeBidi();
    private readonly links: LinkResolver;
    private readonly columns: TableColumns;
    private readonly languages?: LanguageResolver;
    private readonly classes?: (element: SourceElement) => ReadonlyArray<string> | undefined;
    private readonly referrerIndexes: Map<string, Map<string, Array<SourceElement>>> = new Map<string, Map<string, Array<SourceElement>>>();
    private idIndex?: Map<string, Array<SourceElement>>;
    linksBlind: boolean = false;
    columnsBlind: boolean = false;
    languageBlind: boolean = false;

    constructor(root: SourceElement, prefixes: ReadonlyMap<string, string>, links: LinkResolver, columns: TableColumns, languages: LanguageResolver | undefined,
        classes?: (element: SourceElement) => ReadonlyArray<string> | undefined) {
        this.root = root;
        this.prefixes = prefixes;
        this.links = links;
        this.columns = columns;
        if (languages !== undefined) {
            this.languages = languages;
        }
        const rootNamespace: string | undefined = root.getAttributeValue("xmlns");
        if (rootNamespace !== undefined) {
            this.rootNamespace = rootNamespace;
        }
        if (classes !== undefined) {
            this.classes = classes;
        }
        // Namespaces in XML 1.0 §3: only a declared named prefix can put a colon in an element name; xml is never declared.
        this.prefixed = [...prefixes.keys()].some((prefix: string) => prefix.length > 0 && prefix !== "xml");
    }

    localName(element: SourceElement): string {
        return this.prefixed ? element.getLocalName() : element.getName();
    }

    languageOf(element: SourceElement): string | undefined {
        return this.languages === undefined ? element.getLanguage() : this.languages.languageOf(element);
    }

    private namespaceOf(element: SourceElement): string | undefined {
        // Namespaces in XML 1.0 §6.2: xmlns="" leaves unprefixed elements in no namespace. The tree builder gives an element
        // the xmlns in scope unless that is the root's, so nothing above the element has to be read.
        const prefix: string = element.getNamespace();
        const uri: string | undefined = prefix.length > 0 ? this.prefixes.get(prefix) : element.getAttributeValue("xmlns") ?? this.rootNamespace;
        return uri === undefined || uri.length === 0 ? undefined : uri;
    }

    matches(element: SourceElement, steps: ReadonlyArray<CompiledSelectorStep>, scope: ScopingRoot): boolean {
        return this.matchFrom(element, steps, steps.length - 1, scope);
    }

    private matchFrom(element: SourceElement, steps: ReadonlyArray<CompiledSelectorStep>, index: number, scope: ScopingRoot): boolean {
        const step: CompiledSelectorStep = steps[index];
        if (!this.matchCompound(element, step.compound, scope)) {
            return false;
        }
        if (index === 0) {
            return true;
        }
        switch (step.combinator) {
            case "child": {
                const parent: SourceElement | undefined = element.getParent();
                return parent === undefined ? this.matchDocument(steps, index - 1, scope) : this.matchFrom(parent, steps, index - 1, scope);
            }
            case "descendant": {
                let ancestor: SourceElement | undefined = element.getParent();
                while (ancestor !== undefined) {
                    if (this.matchFrom(ancestor, steps, index - 1, scope)) {
                        return true;
                    }
                    ancestor = ancestor.getParent();
                }
                return this.matchDocument(steps, index - 1, scope);
            }
            case "adjacentSibling": {
                const position: number = this.position(element);
                return position > 0 && this.matchFrom(this.siblingsOf(element)[position - 1], steps, index - 1, scope);
            }
            case "generalSibling": {
                const siblings: ReadonlyArray<SourceElement> = this.siblingsOf(element);
                for (let position: number = this.position(element) - 1; position >= 0; position--) {
                    if (this.matchFrom(siblings[position], steps, index - 1, scope)) {
                        return true;
                    }
                }
                return false;
            }
            case "column":
            case "reference":
                return this.backward(element, step.combinator, step.reference)?.some((previous: SourceElement) => this.matchFrom(previous, steps, index - 1, scope)) === true;
            default:
                return false;
        }
    }

    private backward(element: SourceElement, combinator: "column" | "reference", reference?: ReferenceAttribute): ReadonlyArray<SourceElement> | undefined {
        // Selectors 5 §8.1: the column elements of the columns a cell belongs to; §9.1: the elements whose attribute
        // references the element, by an IDREF or by an ID selector.
        if (combinator === "column") {
            return this.columnsBlind ? undefined : this.columns.columnsOf(element);
        }
        const referrers: Map<string, Array<SourceElement>> = this.referrers(reference as ReferenceAttribute);
        let found: Array<SourceElement> | undefined;
        for (const name of SelectorMatcher.ID_ATTRIBUTES) {
            const id: string | undefined = element.getAttributeValue(name);
            if (id === undefined) {
                continue;
            }
            for (const key of [id, "#" + id]) {
                const elements: Array<SourceElement> | undefined = referrers.get(key);
                if (elements !== undefined) {
                    found = found ?? [];
                    found.push(...elements);
                }
            }
        }
        return found;
    }

    private forward(element: SourceElement, combinator: "column" | "reference", reference?: ReferenceAttribute): ReadonlyArray<SourceElement> | undefined {
        if (combinator === "column") {
            return this.columnsBlind ? undefined : this.columns.cellsOf(element);
        }
        const ids: Map<string, Array<SourceElement>> = this.ids();
        let found: Array<SourceElement> | undefined;
        const values: Array<string> | undefined = this.referenceValues(element, reference as ReferenceAttribute);
        if (values === undefined) {
            return undefined;
        }
        for (const value of values) {
            const elements: Array<SourceElement> | undefined = ids.get(value.startsWith("#") ? value.substring(1) : value);
            if (elements !== undefined) {
                found = found ?? [];
                found.push(...elements);
            }
        }
        return found;
    }

    private referenceValues(element: SourceElement, reference: ReferenceAttribute): Array<string> | undefined {
        // Selectors 5 §9.1: the attribute matches by the same rules as in an attribute selector.
        if (reference.namespace.kind === "none") {
            const value: string | undefined = reference.name === "xmlns" ? undefined : element.getAttributeValue(reference.name);
            return value === undefined ? undefined : [value];
        }
        let values: Array<string> | undefined;
        for (const candidate of element.getAttributes()) {
            const name: string = candidate.getName();
            const colon: number = name.indexOf(":");
            const localName: string = colon === -1 ? name : name.substring(colon + 1);
            if (localName === reference.name && name !== "xmlns" && !name.startsWith("xmlns:") && this.matchAttributeNamespace(name, colon, reference.namespace)) {
                values = values ?? [];
                values.push(candidate.getValue());
            }
        }
        return values;
    }

    private referrers(reference: ReferenceAttribute): Map<string, Array<SourceElement>> {
        // Built once per attribute the stylesheet names in a reference combinator, from one walk of the document.
        const key: string = reference.namespace.kind + "|" + (reference.namespace.kind === "uri" ? reference.namespace.uri : "") + "|" + reference.name;
        let referrers: Map<string, Array<SourceElement>> | undefined = this.referrerIndexes.get(key);
        if (referrers === undefined) {
            const built: Map<string, Array<SourceElement>> = new Map<string, Array<SourceElement>>();
            this.visit(this.root, (candidate: SourceElement) => {
                const values: Array<string> | undefined = this.referenceValues(candidate, reference);
                if (values !== undefined) {
                    for (const value of values) {
                        this.addTo(built, value, candidate);
                    }
                }
            });
            this.referrerIndexes.set(key, built);
            referrers = built;
        }
        return referrers;
    }

    private ids(): Map<string, Array<SourceElement>> {
        if (this.idIndex === undefined) {
            const built: Map<string, Array<SourceElement>> = new Map<string, Array<SourceElement>>();
            this.visit(this.root, (candidate: SourceElement) => {
                for (const name of SelectorMatcher.ID_ATTRIBUTES) {
                    const id: string | undefined = candidate.getAttributeValue(name);
                    if (id !== undefined) {
                        this.addTo(built, id, candidate);
                    }
                }
            });
            this.idIndex = built;
        }
        return this.idIndex;
    }

    private addTo(index: Map<string, Array<SourceElement>>, key: string, element: SourceElement): void {
        const list: Array<SourceElement> | undefined = index.get(key);
        if (list === undefined) {
            index.set(key, [element]);
        } else {
            list.push(element);
        }
    }

    private visit(element: SourceElement, action: (element: SourceElement) => void): void {
        action(element);
        for (const child of element.getChildren()) {
            this.visit(child, action);
        }
    }

    private matchDocument(steps: ReadonlyArray<CompiledSelectorStep>, index: number, scope: ScopingRoot): boolean {
        // Selectors 4 §3.3: a virtual scoping root is the parent of the root element, and is featureless: only :scope matches it.
        return scope === "document" && index === 0 && this.matchesFeatureless(steps[0].compound);
    }

    private matchesFeatureless(compound: CompoundSelector): boolean {
        if (compound.type.kind !== "any" || compound.ids !== undefined || compound.classes !== undefined || compound.attributes !== undefined || compound.never
            || compound.negations !== undefined || compound.has !== undefined || compound.nth !== undefined || compound.lang !== undefined || compound.dir !== undefined
            || compound.localLinks !== undefined || (compound.structural !== undefined && !compound.structural.every((pseudo: string) => pseudo === "scope"))) {
            return false;
        }
        return compound.anyOf === undefined || compound.anyOf.every((alternatives: ReadonlyArray<ReadonlyArray<CompiledSelectorStep>>) =>
            alternatives.some((alternative: ReadonlyArray<CompiledSelectorStep>) => alternative.length === 1 && this.matchesFeatureless(alternative[0].compound)));
    }

    private matchCompound(element: SourceElement, compound: CompoundSelector, scope: ScopingRoot): boolean {
        if (compound.never || !this.matchType(element, compound)) {
            return false;
        }
        if (compound.classes !== undefined) {
            // Selectors 4 §6.6: class membership is "as defined by the document language", and no attribute name is assumed
            // outside the languages that define one.
            const classes: ReadonlyArray<string> | undefined = this.classes?.(element);
            if (classes === undefined || !compound.classes.every((name: string) => classes.includes(name))) {
                return false;
            }
        }
        // Selectors 4 §6.7: an element with several ID attributes has all of them as IDs.
        if (compound.ids !== undefined && !compound.ids.every((id: string) => element.getAttributeValue("id") === id || element.getAttributeValue("xml:id") === id)) {
            return false;
        }
        if (compound.attributes !== undefined && !compound.attributes.every((attribute: AttributeMatcher) => this.matchAttribute(element, attribute))) {
            return false;
        }
        if (compound.structural !== undefined && !compound.structural.every((pseudo: string) => this.matchStructural(element, pseudo, scope))) {
            return false;
        }
        if (compound.nth !== undefined && !compound.nth.every((nth: NthMatcher) => this.matchNth(element, nth, scope))) {
            return false;
        }
        if (compound.localLinks !== undefined && (this.linksBlind
            || !compound.localLinks.every((levels: number) => this.links.isLocal(element, levels === SelectorCompiler.WHOLE_URL ? undefined : levels)))) {
            return false;
        }
        if (compound.lang !== undefined && (this.languageBlind || !compound.lang.every((ranges: ReadonlyArray<string>) => this.matchLanguage(element, ranges)))) {
            return false;
        }
        if (compound.dir !== undefined && (this.languageBlind || !compound.dir.every((direction: Direction) => this.directionOf(element) === direction))) {
            return false;
        }
        if (compound.negations !== undefined && compound.negations.some((negation: ReadonlyArray<CompiledSelectorStep>) => this.matchFrom(element, negation, negation.length - 1, scope))) {
            return false;
        }
        if (compound.anyOf !== undefined && !compound.anyOf.every((alternatives: ReadonlyArray<ReadonlyArray<CompiledSelectorStep>>) => this.matchesAny(element, alternatives, scope))) {
            return false;
        }
        return compound.has === undefined || compound.has.every((relatives: ReadonlyArray<RelativeSelector>) =>
            relatives.some((relative: RelativeSelector) => this.matchRelative(element, relative, scope)));
    }

    private matchesAny(element: SourceElement, alternatives: ReadonlyArray<ReadonlyArray<CompiledSelectorStep>>, scope: ScopingRoot): boolean {
        return alternatives.some((steps: ReadonlyArray<CompiledSelectorStep>) => this.matchFrom(element, steps, steps.length - 1, scope));
    }

    private matchRelative(anchor: SourceElement, relative: RelativeSelector, scope: ScopingRoot): boolean {
        // Selectors 4 §3.4 and §4.5: the anchor matches when an element reached through the leading combinator matches the
        // relative selector read back to the anchor.
        const last: number = relative.steps.length - 1;
        const leading: CompiledSelectorStep = relative.steps[0];
        const reaches: (candidate: SourceElement) => boolean = (candidate: SourceElement): boolean =>
            this.matchFrom(candidate, relative.steps, last, scope) && this.anchoredAt(candidate, relative, anchor, scope);
        if (relative.combinator === "column" || relative.combinator === "reference") {
            if (last === 0) {
                return this.forward(anchor, relative.combinator, relative.reference)?.some(reaches) === true;
            }
            return reaches(this.root) || this.anyDescendant(this.root, false, reaches);
        }
        if (relative.steps.some((step: CompiledSelectorStep) => step.combinator === "column" || step.combinator === "reference")) {
            // A column or reference combinator inside the relative selector can lead anywhere in the document.
            return reaches(this.root) || this.anyDescendant(this.root, false, reaches);
        }
        if (relative.combinator === "child" || relative.combinator === "descendant") {
            return this.anyDescendant(anchor, relative.combinator === "child" && last === 0 && leading.combinator === undefined, reaches);
        }
        const siblings: ReadonlyArray<SourceElement> = this.siblingsOf(anchor);
        const start: number = this.position(anchor) + 1;
        const end: number = relative.combinator === "adjacentSibling" && last === 0 ? Math.min(start + 1, siblings.length) : siblings.length;
        for (let position: number = start; position < end; position++) {
            if (reaches(siblings[position]) || (last > 0 && this.anyDescendant(siblings[position], false, reaches))) {
                return true;
            }
        }
        return false;
    }

    private anchoredAt(candidate: SourceElement, relative: RelativeSelector, anchor: SourceElement, scope: ScopingRoot): boolean {
        // The first compound of the relative selector must stand in the leading combinator's relation to the anchor.
        for (const start of this.chainStarts(candidate, relative.steps, relative.steps.length - 1, scope)) {
            if (this.related(anchor, start, relative)) {
                return true;
            }
        }
        return false;
    }

    private chainStarts(element: SourceElement, steps: ReadonlyArray<CompiledSelectorStep>, index: number, scope: ScopingRoot): Array<SourceElement> {
        if (!this.matchCompound(element, steps[index].compound, scope)) {
            return [];
        }
        if (index === 0) {
            return [element];
        }
        const starts: Array<SourceElement> = [];
        for (const previous of this.candidatesBefore(element, steps[index])) {
            starts.push(...this.chainStarts(previous, steps, index - 1, scope));
        }
        return starts;
    }

    private candidatesBefore(element: SourceElement, step: CompiledSelectorStep): Array<SourceElement> {
        const combinator: Combinator | undefined = step.combinator;
        const candidates: Array<SourceElement> = [];
        if (combinator === "column" || combinator === "reference") {
            const before: ReadonlyArray<SourceElement> | undefined = this.backward(element, combinator, step.reference);
            if (before !== undefined) {
                candidates.push(...before);
            }
        } else if (combinator === "child" || combinator === "descendant") {
            let ancestor: SourceElement | undefined = element.getParent();
            while (ancestor !== undefined) {
                candidates.push(ancestor);
                ancestor = combinator === "child" ? undefined : ancestor.getParent();
            }
        } else if (combinator === "adjacentSibling" || combinator === "generalSibling") {
            const siblings: ReadonlyArray<SourceElement> = this.siblingsOf(element);
            const position: number = this.position(element);
            const from: number = combinator === "adjacentSibling" ? Math.max(0, position - 1) : 0;
            candidates.push(...siblings.slice(from, position));
        }
        return candidates;
    }

    private related(anchor: SourceElement, start: SourceElement, relative: RelativeSelector): boolean {
        switch (relative.combinator) {
            case "column":
            case "reference":
                return this.forward(anchor, relative.combinator, relative.reference)?.includes(start) === true;
            case "child":
                return start.getParent() === anchor;
            case "descendant": {
                let ancestor: SourceElement | undefined = start.getParent();
                while (ancestor !== undefined && ancestor !== anchor) {
                    ancestor = ancestor.getParent();
                }
                return ancestor === anchor;
            }
            case "adjacentSibling":
                return start.getParent() === anchor.getParent() && this.position(start) === this.position(anchor) + 1;
            case "generalSibling":
                return start.getParent() === anchor.getParent() && this.position(start) > this.position(anchor);
        }
    }

    private anyDescendant(element: SourceElement, childrenOnly: boolean, test: (candidate: SourceElement) => boolean): boolean {
        for (const child of element.getChildren()) {
            if (test(child) || (!childrenOnly && this.anyDescendant(child, false, test))) {
                return true;
            }
        }
        return false;
    }

    private matchType(element: SourceElement, compound: CompoundSelector): boolean {
        if (compound.type.kind === "localName" && this.localName(element) !== compound.type.name) {
            return false;
        }
        return compound.type.namespace.kind === "any" || this.matchNamespace(compound.type.namespace, this.namespaceOf(element));
    }

    private matchNamespace(constraint: NamespaceConstraint, uri?: string): boolean {
        switch (constraint.kind) {
            case "any":
                return true;
            case "none":
                return uri === undefined;
            case "uri":
                return uri === constraint.uri;
        }
    }

    private matchAttribute(element: SourceElement, attribute: AttributeMatcher): boolean {
        // Selectors 4 §6.4: an unprefixed attribute selector matches only attributes in no namespace, which are the
        // unprefixed ones, so the attribute is found by its name; xmlns declares a namespace and is not an attribute.
        if (attribute.namespace.kind === "none") {
            const value: string | undefined = attribute.name === "xmlns" ? undefined : element.getAttributeValue(attribute.name);
            return value !== undefined && this.matchValue(value, attribute);
        }
        for (const candidate of element.getAttributes()) {
            const name: string = candidate.getName();
            const colon: number = name.indexOf(":");
            const localName: string = colon === -1 ? name : name.substring(colon + 1);
            if (localName !== attribute.name || name === "xmlns" || name.startsWith("xmlns:")) {
                continue;
            }
            if (this.matchAttributeNamespace(name, colon, attribute.namespace) && this.matchValue(candidate.getValue(), attribute)) {
                return true;
            }
        }
        return false;
    }

    private matchAttributeNamespace(name: string, colon: number, constraint: NamespaceConstraint): boolean {
        // Namespaces in XML 1.0 §6.2: an unprefixed attribute is in no namespace and a prefixed one in the namespace of its prefix.
        if (constraint.kind === "uri") {
            return colon !== -1 && this.prefixes.get(name.substring(0, colon)) === constraint.uri;
        }
        return constraint.kind === "any" || colon === -1;
    }

    private matchValue(actual: string, attribute: AttributeMatcher): boolean {
        if (attribute.value === undefined) {
            return true;
        }
        const value: string = attribute.value;
        const compared: string = attribute.caseInsensitive ? this.asciiCase.foldLower(actual) : actual;
        switch (attribute.operator) {
            case "=":
                return compared === value;
            case "~=":
                // Selectors 4 §6.1: "a whitespace-separated list of words", so only white space separates them.
                return value.length > 0 && !SelectorMatcher.LIST_SEPARATOR.test(value) && compared.split(SelectorMatcher.LIST_SEPARATOR).includes(value);
            case "|=":
                return compared === value || compared.startsWith(value + "-");
            case "^=":
                return value.length > 0 && compared.startsWith(value);
            case "$=":
                return value.length > 0 && compared.endsWith(value);
            case "*=":
                return value.length > 0 && compared.includes(value);
            default:
                return false;
        }
    }

    private matchStructural(element: SourceElement, pseudo: string, scope: ScopingRoot): boolean {
        // Selectors 4 §13.3: positions are counted among inclusive siblings, so an element without a parent is its only sibling.
        switch (pseudo) {
            case "any-link":
                return !this.linksBlind && this.links.isLink(element);
            case "root":
                return element.getParent() === undefined;
            case "scope":
                return scope === undefined ? element.getParent() === undefined : element === scope;
            case "empty":
                return element.getContent().every((node: XMLNode) => !(node instanceof SourceElement) && !(node instanceof TextNode && !SelectorMatcher.WHITESPACE_ONLY.test(node.getValue())));
            case "first-child":
                return this.position(element) === 0;
            case "last-child":
                return this.position(element) === this.siblingsOf(element).length - 1;
            case "only-child":
                return this.siblingsOf(element).length === 1;
            case "first-of-type":
                return this.typeIndex(element, false) === 1;
            case "last-of-type":
                return this.typeIndex(element, true) === 1;
            case "only-of-type":
                return this.typeIndex(element, false) === 1 && this.typeIndex(element, true) === 1;
            default:
                return false;
        }
    }

    private matchNth(element: SourceElement, nth: NthMatcher, scope: ScopingRoot): boolean {
        if (nth.kind === "of-type" || nth.kind === "last-of-type") {
            return this.anPlusB.matches(nth.expression, this.typeIndex(element, nth.kind === "last-of-type"));
        }
        if (nth.kind === "col" || nth.kind === "last-col") {
            const column: number | undefined = this.columnsBlind ? undefined : this.columns.columnIndex(element, nth.kind === "last-col");
            return column !== undefined && this.anPlusB.matches(nth.expression, column);
        }
        const of: ReadonlyArray<ReadonlyArray<CompiledSelectorStep>> | undefined = nth.of;
        if (of !== undefined && !this.matchesAny(element, of, scope)) {
            return false;
        }
        const siblings: ReadonlyArray<SourceElement> = this.siblingsOf(element);
        const fromEnd: boolean = nth.kind === "last-child";
        let index: number = 0;
        for (let position: number = fromEnd ? siblings.length - 1 : 0; fromEnd ? position >= 0 : position < siblings.length; position += fromEnd ? -1 : 1) {
            const sibling: SourceElement = siblings[position];
            if (of === undefined || this.matchesAny(sibling, of, scope)) {
                index++;
            }
            if (sibling === element) {
                break;
            }
        }
        return this.anPlusB.matches(nth.expression, index);
    }

    private typeIndex(element: SourceElement, fromEnd: boolean): number {
        // Selectors 4 §13.4: siblings of the same type share the expanded name, namespace and local name.
        const siblings: ReadonlyArray<SourceElement> = this.siblingsOf(element);
        let index: number = 0;
        for (let position: number = fromEnd ? siblings.length - 1 : 0; fromEnd ? position >= 0 : position < siblings.length; position += fromEnd ? -1 : 1) {
            const sibling: SourceElement = siblings[position];
            if (sibling === element) {
                return index + 1;
            }
            if (this.sameType(element, sibling)) {
                index++;
            }
        }
        return index;
    }

    private sameType(element: SourceElement, sibling: SourceElement): boolean {
        // Selectors 4 §13.4: elements of the same type share the expanded name; with one prefix map, the same qualified name
        // means the same namespace.
        return sibling.getName() === element.getName() || (this.prefixed && sibling.getLocalName() === element.getLocalName() && this.namespaceOf(sibling) === this.namespaceOf(element));
    }

    private matchLanguage(element: SourceElement, ranges: ReadonlyArray<string>): boolean {
        // Selectors 4 §7.2: an element whose language is not tagged has the empty language, which only :lang("") matches.
        const language: string = this.languageOf(element) ?? "";
        return ranges.some((range: string) => this.ranges.matches(language, range));
    }

    private directionOf(element: SourceElement): Direction {
        // Selectors 4 §7.1 takes the directionality from the document: the first strong character of the element's text decides
        // (UAX #9 rules P2 and P3), and text without one takes the direction in which its language is written.
        let direction: Direction | undefined = this.directions.get(element);
        if (direction === undefined) {
            const strong: Direction | number = this.firstStrong(element, 0);
            if (typeof strong === "number") {
                const language: string | undefined = this.languageOf(element);
                const code: string | undefined = language === undefined || language.length === 0 ? undefined : LanguageUtils.normalizeCode(language);
                direction = code !== undefined && LanguageUtils.isBiDi(code) ? "rtl" : "ltr";
            } else {
                direction = strong;
            }
            this.directions.set(element, direction);
        }
        return direction;
    }

    private firstStrong(element: SourceElement, isolates: number): Direction | number {
        let open: number = isolates;
        for (const node of element.getContent()) {
            let result: Direction | number = open;
            if (node instanceof TextNode) {
                result = this.bidi.firstStrong(node.getValue(), open);
            } else if (node instanceof SourceElement) {
                result = this.firstStrong(node, open);
            }
            if (typeof result !== "number") {
                return result;
            }
            open = result;
        }
        return open;
    }

    private siblingsOf(element: SourceElement): ReadonlyArray<SourceElement> {
        const parent: SourceElement | undefined = element.getParent();
        if (parent === undefined) {
            return [element];
        }
        let siblings: ReadonlyArray<SourceElement> | undefined = this.siblings.get(parent);
        if (siblings === undefined) {
            siblings = parent.getChildren();
            siblings.forEach((sibling: SourceElement, position: number) => this.positions.set(sibling, position));
            this.siblings.set(parent, siblings);
        }
        return siblings;
    }

    private position(element: SourceElement): number {
        if (element.getParent() === undefined) {
            return 0;
        }
        this.siblingsOf(element);
        return this.positions.get(element) ?? 0;
    }
}
