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

import { AnPlusBParser } from "../css/AnPlusBParser.js";
import { AsciiCase } from "../css/AsciiCase.js";
import type { CompiledSelector } from "../css/CompiledSelector.js";
import { DeclarationReader } from "../css/DeclarationReader.js";
import type {
    ContainerQuery, CssWideKeyword, Declaration, DeclaredValue, MarginBoxName, MarginRule, PageNth, PageRule, PageSelector, Scope, StyleRule
} from "../css/Stylesheet.js";
import { PropertyTable } from "../css/PropertyTable.js";
import type { CssValue } from "../css/values/CssValue.js";
import type { SourceElement } from "../parse/SourceElement.js";
import { LanguageResolver } from "./LanguageResolver.js";
import { LinkResolver } from "./LinkResolver.js";
import type { PageContext, PageGroup } from "./PageCanvas.js";
import { RuleIndex } from "./RuleIndex.js";
import type { ScopingRoot } from "./SelectorMatcher.js";
import { SelectorMatcher } from "./SelectorMatcher.js";
import type { StyleComputer } from "./StyleComputer.js";
import { TableColumns } from "./TableColumns.js";

type Origin = "user-agent" | "presentational-hint" | "author";

interface Candidate {
    declaration: Declaration;
    origin: Origin;
    attached: boolean;
    layer: number;
    specificity: readonly [number, number, number];
    proximity: number;
    order: number;
    position: number;
}

interface ScopeMatch {
    root?: SourceElement | "document";
    proximity: number;
}

const UNSCOPED: number = Number.POSITIVE_INFINITY;
const NO_SCOPE: ReadonlyArray<ScopeMatch> = [{ proximity: UNSCOPED }];
const NO_SPECIFICITY: readonly [number, number, number] = [0, 0, 0];
const ATTACHED_LAYER: number = Number.POSITIVE_INFINITY;
const ATTACHED_ORDER: number = Number.POSITIVE_INFINITY;

export class Cascade {

    private readonly matcher: SelectorMatcher;
    private readonly links: LinkResolver;
    private readonly anPlusB: AnPlusBParser = new AnPlusBParser();
    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly index: RuleIndex;
    private readonly userAgentRules: ReadonlySet<StyleRule>;
    private readonly pseudoElements: Set<string> = new Set<string>();
    private readonly hints?: (element: SourceElement) => ReadonlyArray<Declaration>;
    private readonly attached?: (element: SourceElement) => ReadonlyArray<Declaration>;

    constructor(root: SourceElement, prefixes: ReadonlyMap<string, string>, documentUri: string, styleRules: ReadonlyArray<StyleRule>,
        userAgentRules: ReadonlyArray<StyleRule>, computer: StyleComputer, hints?: (element: SourceElement) => ReadonlyArray<Declaration>,
        attached?: (element: SourceElement) => ReadonlyArray<Declaration>, classes?: (element: SourceElement) => ReadonlyArray<string> | undefined) {
        // A document language gives its presentational hints, its style attribute and its classes (CSS Cascade 5 §6.5, CSS Style
        // Attributes, Selectors 4 §6.6); XML itself defines none of them.
        if (hints !== undefined && attached !== undefined) {
            this.hints = hints;
            this.attached = attached;
        }
        this.links = new LinkResolver(this, computer, root, documentUri);
        const languages: LanguageResolver | undefined = styleRules.some((rule: StyleRule) =>
            rule.declarations.some((declaration: Declaration) => declaration.property === PropertyTable.LANGUAGE)) ? new LanguageResolver(this, computer) : undefined;
        this.matcher = new SelectorMatcher(root, prefixes, this.links, new TableColumns(this, computer, root), languages, classes);
        this.index = new RuleIndex([...userAgentRules, ...styleRules], this.matcher);
        this.userAgentRules = new Set<StyleRule>(userAgentRules);
        for (const rule of [...userAgentRules, ...styleRules]) {
            for (const selector of rule.selectors) {
                if (selector.pseudoElement !== undefined) {
                    this.pseudoElements.add(selector.pseudoElement);
                }
            }
        }
    }

    usesPseudoElement(name: string): boolean {
        return this.pseudoElements.has(name);
    }

    linkOf(element: SourceElement, pseudoElement?: string, value?: CssValue): string | undefined {
        return pseudoElement === undefined ? this.links.targetOf(element) ?? undefined : this.links.pseudoTarget(element, value);
    }

    linkValue(element: SourceElement, value?: CssValue): string | undefined {
        return this.links.pseudoTarget(element, value);
    }

    linkTarget(url: string): SourceElement | undefined {
        return this.links.element(url);
    }

    languageOf(element: SourceElement): string | undefined {
        return this.matcher.languageOf(element);
    }

    element(element: SourceElement, containersHold: (queries: ReadonlyArray<ContainerQuery>) => boolean, pseudoElement?: string): Map<string, DeclaredValue> {
        return this.collect(element, containersHold, pseudoElement);
    }

    linkDeclarations(element: SourceElement): Map<string, DeclaredValue> {
        // Whether an element is a link comes from its link property cascaded without the link pseudo-classes, so that a rule
        // such as a:link { -cssmedia-link: none } cannot decide it; var() in it takes the custom properties of the same cascade.
        const blind: boolean = this.matcher.linksBlind;
        const columnsBlind: boolean = this.matcher.columnsBlind;
        this.matcher.linksBlind = true;
        this.matcher.columnsBlind = true;
        try {
            return this.collect(element, () => false, undefined, (property: string) => property === LinkResolver.PROPERTY || property === LinkResolver.HEADING
                || property.startsWith("--"));
        } finally {
            this.matcher.linksBlind = blind;
            this.matcher.columnsBlind = columnsBlind;
        }
    }

    languageDeclarations(element: SourceElement): Map<string, DeclaredValue> {
        const links: boolean = this.matcher.linksBlind;
        const columns: boolean = this.matcher.columnsBlind;
        const language: boolean = this.matcher.languageBlind;
        this.matcher.linksBlind = true;
        this.matcher.columnsBlind = true;
        this.matcher.languageBlind = true;
        try {
            return this.collect(element, () => false, undefined, (property: string) => property === PropertyTable.LANGUAGE || property.startsWith("--"));
        } finally {
            this.matcher.linksBlind = links;
            this.matcher.columnsBlind = columns;
            this.matcher.languageBlind = language;
        }
    }

    structureDeclarations(element: SourceElement, pseudoElement?: string): Map<string, DeclaredValue> {
        // Which column a cell belongs to comes from the display types cascaded without the grid-structural selectors, so that
        // a rule such as :nth-col(2) { display: none } cannot decide it.
        const blind: boolean = this.matcher.columnsBlind;
        this.matcher.columnsBlind = true;
        try {
            return this.collect(element, () => false, pseudoElement, (property: string) => TableColumns.PROPERTIES.has(property) || property.startsWith("--"));
        } finally {
            this.matcher.columnsBlind = blind;
        }
    }

    private collect(element: SourceElement, containersHold: (queries: ReadonlyArray<ContainerQuery>) => boolean, pseudoElement?: string,
        wanted?: (property: string) => boolean): Map<string, DeclaredValue> {
        // CSS Cascade 5 §6.1: the cascade gives the declaration that wins; the others count only when the winner is revert
        // or revert-layer (§7.3.4 and §7.3.5), so only then are they all gathered.
        const leaders: Map<string, Candidate> = new Map<string, Candidate>();
        this.gather(element, containersHold, pseudoElement, wanted, leaders);
        const won: Array<Candidate> = [];
        for (const leader of leaders.values()) {
            const value: DeclaredValue = leader.declaration.value;
            if (value.kind === "keyword" && (value.keyword === "revert" || value.keyword === "revert-layer")) {
                const candidates: Map<string, Array<Candidate>> = new Map<string, Array<Candidate>>();
                this.gather(element, containersHold, pseudoElement, wanted, undefined, candidates);
                return this.winners(candidates);
            }
            won.push(leader);
        }
        // The same order as in winners(): increasing precedence of the winning declarations.
        won.sort((first: Candidate, second: Candidate) => this.precedes(first, second) ? 1 : (this.precedes(second, first) ? -1 : 0));
        const result: Map<string, DeclaredValue> = new Map<string, DeclaredValue>();
        for (const candidate of won) {
            result.set(candidate.declaration.property, candidate.declaration.value);
        }
        return result;
    }

    private gather(element: SourceElement, containersHold: (queries: ReadonlyArray<ContainerQuery>) => boolean, pseudoElement?: string,
        wanted?: (property: string) => boolean, leaders?: Map<string, Candidate>, candidates?: Map<string, Array<Candidate>>): void {
        const rules: ReadonlyArray<StyleRule> | undefined = this.index.candidates(element, pseudoElement);
        if (rules === undefined) {
            return;
        }
        for (const rule of rules) {
            if (rule.containers.length > 0 && !containersHold(rule.containers)) {
                continue;
            }
            const scopes: ReadonlyArray<ScopeMatch> = rule.scope === undefined ? NO_SCOPE : this.scopeMatches(element, rule.scope);
            let specificity: readonly [number, number, number] | undefined;
            let proximity: number = UNSCOPED;
            for (const scope of scopes) {
                for (const selector of rule.selectors) {
                    if (selector.pseudoElement !== pseudoElement || !this.matcher.matches(element, selector.steps, scope.root)) {
                        continue;
                    }
                    // Selectors 4 §15: a rule with a selector list counts with the most specific selector that matches.
                    const difference: number = specificity === undefined ? 1 : this.compareSpecificity(selector.specificity, specificity);
                    if (difference > 0 || (difference === 0 && scope.proximity < proximity)) {
                        specificity = selector.specificity;
                        proximity = scope.proximity;
                    }
                }
            }
            if (specificity === undefined) {
                continue;
            }
            const origin: Origin = this.userAgentRules.has(rule) ? "user-agent" : "author";
            const declarations: ReadonlyArray<Declaration> = wanted === undefined ? rule.declarations : rule.declarations.filter((declaration: Declaration) => wanted(declaration.property));
            if (candidates !== undefined) {
                this.addDeclarations(candidates, declarations, origin, false, rule.layer, specificity, proximity, rule.order);
            } else if (leaders !== undefined) {
                this.lead(leaders, declarations, origin, false, rule.layer, specificity, proximity, rule.order);
            }
        }
        if (pseudoElement !== undefined || this.hints === undefined || this.attached === undefined) {
            return;
        }
        // CSS Cascade 5 §6.5: presentational hints are rules of an origin of their own between the user and the author origins;
        // §6.1: the declarations attached to the element take precedence over the rules of their importance.
        for (const [origin, attached, all] of [["presentational-hint", false, this.hints(element)], ["author", true, this.attached(element)]] as
            ReadonlyArray<readonly [Origin, boolean, ReadonlyArray<Declaration>]>) {
            const declarations: ReadonlyArray<Declaration> = wanted === undefined ? all : all.filter((declaration: Declaration) => wanted(declaration.property));
            const layer: number = attached ? ATTACHED_LAYER : 0;
            const order: number = attached ? ATTACHED_ORDER : 0;
            if (declarations.length === 0) {
                continue;
            }
            if (candidates !== undefined) {
                this.addDeclarations(candidates, declarations, origin, attached, layer, NO_SPECIFICITY, UNSCOPED, order);
            } else if (leaders !== undefined) {
                this.lead(leaders, declarations, origin, attached, layer, NO_SPECIFICITY, UNSCOPED, order);
            }
        }
    }

    private lead(leaders: Map<string, Candidate>, declarations: ReadonlyArray<Declaration>, origin: Origin, attached: boolean, layer: number,
        specificity: readonly [number, number, number], proximity: number, order: number): void {
        let probe: Candidate | undefined;
        for (let position: number = 0; position < declarations.length; position++) {
            const declaration: Declaration = this.normalized(declarations[position]);
            const leader: Candidate | undefined = leaders.get(declaration.property);
            if (leader === undefined) {
                leaders.set(declaration.property, { declaration, origin, attached, layer, specificity, proximity, order, position });
                continue;
            }
            if (probe === undefined) {
                probe = { declaration, origin, attached, layer, specificity, proximity, order, position };
            }
            probe.declaration = declaration;
            probe.position = position;
            if (this.precedes(probe, leader)) {
                leader.declaration = declaration;
                leader.origin = origin;
                leader.attached = attached;
                leader.layer = layer;
                leader.specificity = specificity;
                leader.proximity = proximity;
                leader.order = order;
                leader.position = position;
            }
        }
    }

    page(context: PageContext, rules: ReadonlyArray<PageRule>, userAgentRules: ReadonlyArray<PageRule>): Map<string, DeclaredValue> {
        return this.pageDeclarations(context, rules, userAgentRules, (rule: PageRule) => rule.declarations);
    }

    marginBox(context: PageContext, name: MarginBoxName, rules: ReadonlyArray<PageRule>, userAgentRules: ReadonlyArray<PageRule>): Map<string, DeclaredValue> {
        return this.pageDeclarations(context, rules, userAgentRules, (rule: PageRule) =>
            rule.marginRules.filter((marginRule: MarginRule) => marginRule.name === name).flatMap((marginRule: MarginRule) => marginRule.declarations));
    }

    footnote(context: PageContext, rules: ReadonlyArray<PageRule>, userAgentRules: ReadonlyArray<PageRule>): Map<string, DeclaredValue> {
        return this.pageDeclarations(context, rules, userAgentRules, (rule: PageRule) => rule.footnote);
    }

    private pageDeclarations(context: PageContext, rules: ReadonlyArray<PageRule>, userAgentRules: ReadonlyArray<PageRule>,
        declarationsOf: (rule: PageRule) => ReadonlyArray<Declaration>): Map<string, DeclaredValue> {
        // CSS Paged Media 3 §4.4: "Declarations in page and margin contexts cascade just like declarations in style rule for
        // elements", ordered by the specificity of the page selectors of their @page rule.
        const candidates: Map<string, Array<Candidate>> = new Map<string, Array<Candidate>>();
        for (const [origin, list] of [["user-agent", userAgentRules], ["author", rules]] as Array<[Origin, ReadonlyArray<PageRule>]>) {
            for (const rule of list) {
                const specificity: readonly [number, number, number] | undefined = this.pageSpecificity(context, rule.selectors);
                if (specificity !== undefined) {
                    this.addDeclarations(candidates, declarationsOf(rule), origin, false, rule.layer, specificity, UNSCOPED, rule.order);
                }
            }
        }
        return this.winners(candidates);
    }

    private pageSpecificity(context: PageContext, selectors: ReadonlyArray<PageSelector>): readonly [number, number, number] | undefined {
        if (selectors.length === 0) {
            return NO_SPECIFICITY;
        }
        let best: readonly [number, number, number] | undefined;
        for (const selector of selectors) {
            if (this.matchesPage(context, selector) && (best === undefined || this.compareSpecificity(selector.specificity, best) > 0)) {
                best = selector.specificity;
            }
        }
        return best;
    }

    private matchesPage(context: PageContext, selector: PageSelector): boolean {
        if (selector.name !== undefined && selector.name !== context.name) {
            return false;
        }
        for (const pseudo of selector.pseudoClasses) {
            if ((pseudo === "first" && !context.first) || (pseudo === "blank" && !context.blank) || ((pseudo === "left" || pseudo === "right") && pseudo !== context.side)) {
                return false;
            }
        }
        return selector.nth.every((nth: PageNth) => this.matchesNth(context, nth));
    }

    private matchesNth(context: PageContext, nth: PageNth): boolean {
        // GCPM 3 §3.1 and §3.2: without "of", pages count from the start of the document; with it, within the page group of that name.
        if (nth.group === undefined) {
            return this.anPlusB.matches(nth.expression, context.position);
        }
        const group: PageGroup | undefined = context.groups.find((candidate: PageGroup) => candidate.name === nth.group);
        return group !== undefined && this.anPlusB.matches(nth.expression, group.position);
    }

    private scopeMatches(element: SourceElement, scope: Scope): Array<ScopeMatch> {
        // CSS Cascade 6 §2.5: the subject must be in scope of a scoping root, and proximity counts the generations between them.
        const matches: Array<ScopeMatch> = [];
        const outerRoots: Array<ScopingRoot> = scope.parent === undefined ? [undefined] : this.scopeMatches(element, scope.parent).map((match: ScopeMatch) => match.root);
        let candidate: SourceElement | undefined = element;
        let generations: number = 0;
        while (candidate !== undefined) {
            const current: SourceElement = candidate;
            if (scope.start !== undefined && outerRoots.some((outer: ScopingRoot) => this.matchesAny(current, scope.start as ReadonlyArray<CompiledSelector>, outer))
                && this.inScope(element, current, scope)) {
                matches.push({ root: current, proximity: generations });
            }
            candidate = candidate.getParent();
            generations++;
        }
        if (scope.start === undefined && this.inScope(element, "document", scope)) {
            // CSS Cascade 6 §2.5.4: without <scope-start>, a stylesheet that no element owns is scoped to the document.
            matches.push({ root: "document", proximity: generations });
        }
        return matches;
    }

    private inScope(element: SourceElement, root: ScopingRoot, scope: Scope): boolean {
        if (scope.end === undefined) {
            return true;
        }
        let candidate: SourceElement | undefined = element;
        while (candidate !== undefined) {
            if (this.matchesAny(candidate, scope.end, root)) {
                return false;
            }
            if (candidate === root) {
                return true;
            }
            candidate = candidate.getParent();
        }
        return true;
    }

    private matchesAny(element: SourceElement, selectors: ReadonlyArray<CompiledSelector>, root: ScopingRoot): boolean {
        return selectors.some((selector: CompiledSelector) => this.matcher.matches(element, selector.steps, root));
    }

    private addDeclarations(candidates: Map<string, Array<Candidate>>, declarations: ReadonlyArray<Declaration>, origin: Origin, attached: boolean, layer: number,
        specificity: readonly [number, number, number], proximity: number, order: number): void {
        for (let position: number = 0; position < declarations.length; position++) {
            const declaration: Declaration = declarations[position];
            const entry: Candidate = { declaration: this.normalized(declaration), origin, attached, layer, specificity, proximity, order, position };
            const list: Array<Candidate> | undefined = candidates.get(declaration.property);
            if (list === undefined) {
                candidates.set(declaration.property, [entry]);
            } else {
                list.push(entry);
            }
        }
    }

    private normalized(declaration: Declaration): Declaration {
        // CSS Variables 1 §2: a custom property whose whole value is a CSS-wide keyword takes that keyword's meaning.
        if (declaration.value.kind !== "custom") {
            return declaration;
        }
        const keyword: string = this.asciiCase.foldLower(declaration.value.text.trim());
        return DeclarationReader.CSS_WIDE_KEYWORDS.has(keyword) ? { ...declaration, value: { kind: "keyword", keyword: keyword as CssWideKeyword } } : declaration;
    }

    private winners(candidates: Map<string, Array<Candidate>>): Map<string, DeclaredValue> {
        // The properties are entered in increasing precedence of their winning declarations, so that a logical property and
        // its physical pair can be cascaded together once the writing mode is known (CSS Logical 1 §4).
        const entries: Array<[string, DeclaredValue, Candidate]> = [];
        for (const [property, list] of candidates) {
            const won: [DeclaredValue, Candidate] | undefined = this.cascaded(list);
            if (won !== undefined) {
                entries.push([property, won[0], won[1]]);
            }
        }
        entries.sort((first: [string, DeclaredValue, Candidate], second: [string, DeclaredValue, Candidate]) =>
            this.precedes(first[2], second[2]) ? 1 : (this.precedes(second[2], first[2]) ? -1 : 0));
        return new Map<string, DeclaredValue>(entries.map((entry: [string, DeclaredValue, Candidate]): [string, DeclaredValue] => [entry[0], entry[1]]));
    }

    private cascaded(list: ReadonlyArray<Candidate>): [DeclaredValue, Candidate] | undefined {
        // CSS Cascade 5 §7.3.4 and §7.3.5: revert drops the winner's origin, revert-layer the winner's layer in its origin,
        // and the cascade runs again on what remains; revert in the user-agent origin acts as unset.
        let remaining: ReadonlyArray<Candidate> = list;
        while (remaining.length > 0) {
            const winner: Candidate = remaining.reduce((best: Candidate, candidate: Candidate) => this.precedes(candidate, best) ? candidate : best);
            const value: DeclaredValue = winner.declaration.value;
            if (value.kind === "keyword" && value.keyword === "revert") {
                if (winner.origin === "user-agent") {
                    return [{ kind: "keyword", keyword: "unset" }, winner];
                }
                // §6.5: "for the purpose of the revert keyword" the presentational hints are "part of the author origin".
                remaining = remaining.filter((candidate: Candidate) => candidate.origin === "user-agent");
            } else if (value.kind === "keyword" && value.keyword === "revert-layer") {
                remaining = remaining.filter((candidate: Candidate) => candidate.origin !== winner.origin || candidate.layer !== winner.layer);
            } else {
                return [value, winner];
            }
        }
        return undefined;
    }

    private precedes(first: Candidate, second: Candidate): boolean {
        // CSS Cascade 6 §2.1: origin and importance, layers, specificity, scope proximity, order of appearance, which inside one
        // rule is the order of its declarations.
        const firstRank: number = this.rank(first);
        const secondRank: number = this.rank(second);
        if (firstRank !== secondRank) {
            return firstRank > secondRank;
        }
        if (first.attached !== second.attached) {
            return first.attached;
        }
        if (first.origin === second.origin && first.layer !== second.layer) {
            return first.declaration.important ? first.layer < second.layer : first.layer > second.layer;
        }
        const specificity: number = this.compareSpecificity(first.specificity, second.specificity);
        if (specificity !== 0) {
            return specificity > 0;
        }
        if (first.proximity !== second.proximity) {
            return first.proximity < second.proximity;
        }
        return first.order !== second.order ? first.order > second.order : first.position > second.position;
    }

    private rank(candidate: Candidate): number {
        if (candidate.declaration.important) {
            return candidate.origin === "user-agent" ? 4 : 3;
        }
        return candidate.origin === "author" ? 2 : (candidate.origin === "presentational-hint" ? 1 : 0);
    }

    private compareSpecificity(first: readonly [number, number, number], second: readonly [number, number, number]): number {
        return first[0] - second[0] || first[1] - second[1] || first[2] - second[2];
    }
}
