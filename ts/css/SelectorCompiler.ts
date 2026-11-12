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

import type { AttributeSelector, CssNode, Nth, PseudoClassSelector, PseudoElementSelector, Selector } from "css-tree";
import { parse, tokenize, tokenTypes } from "css-tree";
import { AnPlusBParser } from "./AnPlusBParser.js";
import { AsciiCase } from "./AsciiCase.js";
import type {
    AttributeMatcher, AttributeOperator, Combinator, CompiledSelector, CompiledSelectorStep, Direction, NamespaceConstraint, NthKind, NthMatcher, ReferenceAttribute,
    RelativeSelector, StructuralPseudoClass, TypeMatcher
} from "./CompiledSelector.js";
import { CssIdentifierEscaping } from "./CssIdentifierEscaping.js";
import { DeclarationReader } from "./DeclarationReader.js";
import type { AnPlusB } from "./Stylesheet.js";

type Specificity = [number, number, number];

interface MutableCompound {
    type: TypeMatcher;
    explicitType: boolean;
    ids?: Array<string>;
    classes?: Array<string>;
    attributes?: Array<AttributeMatcher>;
    structural?: Array<StructuralPseudoClass>;
    negations?: Array<ReadonlyArray<CompiledSelectorStep>>;
    anyOf?: Array<ReadonlyArray<ReadonlyArray<CompiledSelectorStep>>>;
    has?: Array<ReadonlyArray<RelativeSelector>>;
    nth?: Array<NthMatcher>;
    lang?: Array<ReadonlyArray<string>>;
    dir?: Array<Direction>;
    localLinks?: Array<number>;
    never: boolean;
}

interface Compiled {
    steps: Array<CompiledSelectorStep>;
    pseudoElement?: string;
    specificity: Specificity;
}

interface Link {
    combinator: Combinator;
    reference?: ReferenceAttribute;
}

interface State {
    matches: boolean;
    specificity: Specificity;
}

const STRUCTURAL: ReadonlySet<string> = new Set<string>(["root", "empty", "first-child", "last-child", "only-child", "first-of-type", "last-of-type", "only-of-type", "scope"]);

const NTH_KINDS: ReadonlyMap<string, NthKind> = new Map<string, NthKind>([
    ["nth-child", "child"], ["nth-last-child", "last-child"], ["nth-of-type", "of-type"], ["nth-last-of-type", "last-of-type"]
]);

const USER_ACTION: ReadonlySet<string> = new Set<string>(["hover", "active", "focus", "focus-visible", "focus-within", "interest-source", "interest-target"]);

const NEVER_MATCHING: ReadonlySet<string> = new Set<string>([
    ...USER_ACTION, "visited", "target", "playing", "paused", "seeking", "buffering", "stalled", "muted", "volume-locked",
    "open", "popover-open", "modal", "fullscreen", "picture-in-picture", "enabled", "disabled", "read-write", "placeholder-shown", "autofill", "default",
    "checked", "unchecked", "indeterminate", "blank", "valid", "invalid", "in-range", "out-of-range", "required", "optional", "user-valid", "user-invalid",
    "current", "past", "future", "heading"
]);

const ALWAYS_MATCHING: ReadonlySet<string> = new Set<string>(["read-only", "defined"]);

const LOGICAL: ReadonlySet<string> = new Set<string>(["is", "matches", "where", "not", "has"]);

const LEGACY_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set<string>(["before", "after", "first-line", "first-letter"]);

const PSEUDO_ELEMENTS: ReadonlySet<string> = new Set<string>([
    "before", "after", "marker", "first-line", "first-letter", "footnote-call", "footnote-marker", "selection", "search-text", "target-text",
    "spelling-error", "grammar-error", "placeholder", "file-selector-button", "details-content", "backdrop"
]);

const SUB_PSEUDO_ELEMENTS: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
    ["before", new Set<string>(["marker"])], ["after", new Set<string>(["marker"])], ["first-letter", new Set<string>(["prefix", "suffix"])]
]);


const ATTRIBUTE_OPERATORS: ReadonlySet<string> = new Set<string>(["=", "~=", "|=", "^=", "$=", "*="]);

const COMBINATORS: ReadonlyMap<string, Combinator> = new Map<string, Combinator>([
    [" ", "descendant"], [">", "child"], ["+", "adjacentSibling"], ["~", "generalSibling"], ["||", "column"]
]);

const NO_SPECIFICITY: Specificity = [0, 0, 0];

class InvalidSelector extends Error {
}

export class SelectorCompiler {

    static readonly WHOLE_URL: number = -1;
    static readonly DEFAULT_NAMESPACE: string = "";

    private readonly escaping: CssIdentifierEscaping = new CssIdentifierEscaping();
    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly anPlusBParser: AnPlusBParser = new AnPlusBParser();
    private hasDepth: number = 0;

    compile(selector: Selector, namespaces: ReadonlyMap<string, string>): CompiledSelector | undefined {
        try {
            const compiled: Compiled = this.compileSelector(selector, namespaces, false, false);
            return compiled;
        } catch (error) {
            if (error instanceof InvalidSelector) {
                return undefined;
            }
            throw error;
        }
    }

    private compileSelector(selector: Selector, namespaces: ReadonlyMap<string, string>, relative: boolean, exempt: boolean): Compiled {
        const steps: Array<CompiledSelectorStep> = [];
        const compounds: Array<MutableCompound> = [];
        const specificity: Specificity = [0, 0, 0];
        const components: Array<CssNode> = selector.children.toArray();
        const pseudoElements: Array<string> = [];
        let pseudoMatches: boolean = true;
        let compound: MutableCompound = this.emptyCompound();
        let link: Link | undefined;
        let empty: boolean = true;
        if (relative && components.length > 0 && components[0].type === "Combinator") {
            // Selectors 4 §3.4: a relative selector starts with a combinator; without one it is a descendant combinator.
            components.shift();
        }
        for (const component of components) {
            if (pseudoElements.length > 0) {
                // Selectors 4 §3.6.3 and §3.6.4: after a pseudo-element only its sub-pseudo-elements and the pseudo-classes
                // that describe its state may follow.
                if (this.isPseudoElement(component)) {
                    pseudoElements.push(this.pseudoElementName(component as PseudoElementSelector | PseudoClassSelector, pseudoElements));
                    specificity[2]++;
                } else if (component.type === "PseudoClassSelector") {
                    const state: State = this.pseudoState(component);
                    pseudoMatches = pseudoMatches && state.matches;
                    this.addSpecificity(specificity, state.specificity);
                } else {
                    throw new InvalidSelector();
                }
                continue;
            }
            switch (component.type) {
                case "TypeSelector":
                    compound.type = this.typeMatcher(component.name, namespaces);
                    compound.explicitType = true;
                    if (!this.escaping.isUniversalType(component.name)) {
                        specificity[2]++;
                    }
                    break;
                case "IdSelector":
                    compound.ids = compound.ids ?? [];
                    compound.ids.push(this.escaping.unescape(component.name));
                    specificity[0]++;
                    break;
                case "ClassSelector":
                    compound.classes = compound.classes ?? [];
                    compound.classes.push(this.escaping.unescape(component.name));
                    specificity[1]++;
                    break;
                case "AttributeSelector":
                    compound.attributes = compound.attributes ?? [];
                    compound.attributes.push(this.attributeMatcher(component, namespaces));
                    specificity[1]++;
                    break;
                case "PseudoClassSelector":
                    if (this.isPseudoElement(component)) {
                        pseudoElements.push(this.pseudoElementName(component, pseudoElements));
                        specificity[2]++;
                    } else {
                        this.addSpecificity(specificity, this.applyPseudoClass(component, this.asciiCase.foldLower(component.name), compound, namespaces));
                    }
                    break;
                case "PseudoElementSelector":
                    pseudoElements.push(this.pseudoElementName(component, pseudoElements));
                    specificity[2]++;
                    break;
                case "NestingSelector":
                    // CSS Nesting 1 §4: outside a nested rule the nesting selector represents :scope.
                    compound.structural = compound.structural ?? [];
                    compound.structural.push("scope");
                    specificity[1]++;
                    break;
                case "Combinator": {
                    if (empty) {
                        throw new InvalidSelector();
                    }
                    steps.push(this.step(compound, link));
                    compounds.push(compound);
                    compound = this.emptyCompound();
                    link = this.link(component.name, namespaces);
                    empty = true;
                    continue;
                }
                default:
                    throw new InvalidSelector();
            }
            empty = false;
        }
        if (empty) {
            throw new InvalidSelector();
        }
        // Selectors 4 §3.6.3: a pseudo-element followed by pseudo-classes is represented only when it is in that state.
        compound.never = compound.never || !pseudoMatches;
        steps.push(this.step(compound, link));
        compounds.push(compound);
        this.applyDefaultNamespace(compounds, namespaces, exempt);
        return pseudoElements.length === 0 ? { steps, specificity } : { steps, pseudoElement: pseudoElements.join("::"), specificity };
    }

    private step(compound: MutableCompound, link?: Link): CompiledSelectorStep {
        const step: CompiledSelectorStep = { compound };
        if (link !== undefined) {
            step.combinator = link.combinator;
        }
        if (link !== undefined && link.reference !== undefined) {
            step.reference = link.reference;
        }
        return step;
    }

    private isPseudoElement(component: CssNode): boolean {
        // Selectors 4 §16: CSS 2 wrote four pseudo-elements with one colon, and that syntax stays valid.
        return component.type === "PseudoElementSelector"
            || (component.type === "PseudoClassSelector" && component.children === null && LEGACY_PSEUDO_ELEMENTS.has(this.asciiCase.foldLower(component.name)));
    }

    private pseudoElementName(component: PseudoElementSelector | PseudoClassSelector, path: ReadonlyArray<string>): string {
        // Selectors 4 §3.6.4: a pseudo-element compounds to another only where a specification defines that sub-pseudo-element,
        // as Lists 3 does for ::before::marker and Pseudo-Elements 4 §2.2 for ::first-letter::prefix and ::suffix.
        const name: string = this.asciiCase.foldLower(component.name);
        if (component.children !== null) {
            // CSS Pseudo-Elements 4 §3.1: ::highlight( <custom-ident> ).
            const identifier: string | undefined = name === "highlight" && path.length === 0 ? this.customIdent(this.argumentText(component)) : undefined;
            if (identifier === undefined) {
                throw new InvalidSelector();
            }
            return name + "(" + identifier + ")";
        }
        const allowed: boolean = path.length === 0 ? PSEUDO_ELEMENTS.has(name) : SUB_PSEUDO_ELEMENTS.get(path[path.length - 1])?.has(name) === true;
        if (!allowed) {
            throw new InvalidSelector();
        }
        return name;
    }

    private pseudoState(component: PseudoClassSelector): State {
        // Selectors 4 §3.6.3: a pseudo-element may be followed by the user action and the logical combination pseudo-classes,
        // whose arguments take the same restriction; no user action happens on a printed page.
        const name: string = this.asciiCase.foldLower(component.name);
        if (component.children === null) {
            if (!USER_ACTION.has(name)) {
                throw new InvalidSelector();
            }
            return { matches: false, specificity: [0, 1, 0] };
        }
        if (!LOGICAL.has(name)) {
            throw new InvalidSelector();
        }
        const forgiving: boolean = name === "is" || name === "matches" || name === "where";
        const states: Array<State> = this.stateArguments(component.children.first, name === "has", forgiving);
        const highest: Specificity = this.highest(states.map((state: State) => state.specificity));
        switch (name) {
            case "not":
                return { matches: !states.some((state: State) => state.matches), specificity: highest };
            case "has":
                // A pseudo-element has no elements inside it, so no relative selector finds anything.
                return { matches: false, specificity: highest };
            default:
                return { matches: states.some((state: State) => state.matches), specificity: name === "where" ? [0, 0, 0] : highest };
        }
    }

    private stateArguments(list: CssNode | null, relative: boolean, forgiving: boolean): Array<State> {
        if (list === null || list.type !== "SelectorList") {
            if (forgiving) {
                return [];
            }
            throw new InvalidSelector();
        }
        const states: Array<State> = [];
        for (const item of list.children) {
            try {
                if (item.type !== "Selector") {
                    throw new InvalidSelector();
                }
                const components: Array<CssNode> = item.children.toArray();
                if (relative && components.length > 0 && components[0].type === "Combinator") {
                    components.shift();
                }
                if (components.length === 0) {
                    throw new InvalidSelector();
                }
                const state: State = { matches: true, specificity: [0, 0, 0] };
                for (const component of components) {
                    if (component.type !== "PseudoClassSelector" || this.isPseudoElement(component)) {
                        throw new InvalidSelector();
                    }
                    const inner: State = this.pseudoState(component);
                    state.matches = state.matches && inner.matches;
                    this.addSpecificity(state.specificity, inner.specificity);
                }
                states.push(state);
            } catch (error) {
                if (!forgiving || !(error instanceof InvalidSelector)) {
                    throw error;
                }
            }
        }
        if (states.length === 0 && !forgiving) {
            throw new InvalidSelector();
        }
        return states;
    }

    private link(name: string, namespaces: ReadonlyMap<string, string>): Link {
        // Selectors 5 §9.1: the reference combinator is "/" <wq-name> "/", whose attribute matches as in an attribute selector.
        const combinator: Combinator | undefined = COMBINATORS.get(name);
        if (combinator !== undefined) {
            return { combinator };
        }
        if (name.length > 2 && name.startsWith("/") && name.endsWith("/")) {
            const qualified: string = name.substring(1, name.length - 1);
            const pipe: number = this.escaping.rawPipeIndex(qualified);
            const attribute: string = this.escaping.unescape(pipe === -1 ? qualified : qualified.slice(pipe + 1));
            const namespace: NamespaceConstraint = pipe === -1 ? { kind: "none" } : this.namespaceConstraint(this.escaping.unescape(qualified.slice(0, pipe)), namespaces);
            return { combinator: "reference", reference: { name: attribute, namespace } };
        }
        throw new InvalidSelector();
    }

    private applyDefaultNamespace(compounds: ReadonlyArray<MutableCompound>, namespaces: ReadonlyMap<string, string>, exempt: boolean): void {
        // Selectors 4 §5.3: a compound without a type selector matches only the default namespace, except, per §4.2 to §4.4,
        // the subject of a selector inside :is(), :where() or :not().
        const defaultUri: string | undefined = namespaces.get(SelectorCompiler.DEFAULT_NAMESPACE);
        if (defaultUri === undefined) {
            return;
        }
        compounds.forEach((compound: MutableCompound, index: number) => {
            if (!compound.explicitType && !(exempt && index === compounds.length - 1)) {
                compound.type = { kind: "any", namespace: this.uriConstraint(defaultUri) };
            }
        });
    }

    private applyPseudoClass(pseudoClass: PseudoClassSelector, name: string, compound: MutableCompound, namespaces: ReadonlyMap<string, string>): Specificity {
        // Selectors 4 §15: :is(), :not() and :has() count as their most specific argument, :where() as nothing,
        // and :nth-child(An+B of S) as a pseudo-class plus its most specific S.
        const argument: CssNode | null = pseudoClass.children === null ? null : pseudoClass.children.first;
        if (pseudoClass.children === null) {
            if (STRUCTURAL.has(name)) {
                compound.structural = compound.structural ?? [];
                compound.structural.push(name as StructuralPseudoClass);
            } else if (name === "link" || name === "any-link") {
                // Selectors 4 §8.1 and §8.2: with every link unvisited, :link and :any-link match the same elements.
                compound.structural = compound.structural ?? [];
                compound.structural.push("any-link");
            } else if (name === "local-link") {
                // Selectors 5 §2.1: without an argument the whole URL is compared, which no count of path levels says.
                compound.localLinks = compound.localLinks ?? [];
                compound.localLinks.push(SelectorCompiler.WHOLE_URL);
            } else if (NEVER_MATCHING.has(name)) {
                compound.never = true;
            } else if (!ALWAYS_MATCHING.has(name)) {
                throw new InvalidSelector();
            }
            return [0, 1, 0];
        }
        switch (name) {
            case "not": {
                const alternatives: Array<Compiled> = this.selectorList(argument, namespaces, false, false, true);
                compound.negations = compound.negations ?? [];
                compound.negations.push(...alternatives.map((alternative: Compiled) => alternative.steps));
                return this.highestOf(alternatives);
            }
            case "is":
            case "matches":
            case "where": {
                // Selectors 4 §4.2: :matches() is the obsolete name of :is(), which UAs may implement as a legacy alias.
                const alternatives: Array<Compiled> = this.selectorList(argument, namespaces, false, true, true);
                compound.anyOf = compound.anyOf ?? [];
                compound.anyOf.push(alternatives.map((alternative: Compiled) => alternative.steps));
                return name === "where" ? [0, 0, 0] : this.highestOf(alternatives);
            }
            case "has": {
                // Selectors 4 §4.5: "The :has() pseudo-class cannot be nested; :has() is not valid within :has()."
                if (this.hasDepth > 0) {
                    throw new InvalidSelector();
                }
                this.hasDepth++;
                try {
                    const alternatives: Array<Compiled> = this.selectorList(argument, namespaces, true, false, false);
                    compound.has = compound.has ?? [];
                    compound.has.push(alternatives.map((alternative: Compiled, index: number) => {
                        const leading: Link = this.leadingLink(argument, index, namespaces);
                        return leading.reference === undefined ? { combinator: leading.combinator, steps: alternative.steps }
                            : { combinator: leading.combinator, reference: leading.reference, steps: alternative.steps };
                    }));
                    return this.highestOf(alternatives);
                } finally {
                    this.hasDepth--;
                }
            }
            case "lang":
                compound.lang = compound.lang ?? [];
                compound.lang.push(this.languageRanges(pseudoClass));
                return [0, 1, 0];
            case "dir": {
                // Selectors 4 §7.1: the argument is a single identifier, and "Values other than ltr and rtl are not invalid,
                // but do not match anything."
                if (argument === null || argument.type !== "Identifier" || pseudoClass.children?.size !== 1) {
                    throw new InvalidSelector();
                }
                const direction: string = this.asciiCase.foldLower(this.escaping.unescape(argument.name));
                if (direction === "ltr" || direction === "rtl") {
                    compound.dir = compound.dir ?? [];
                    compound.dir.push(direction);
                } else {
                    compound.never = true;
                }
                return [0, 1, 0];
            }
            default:
                return this.applySelectors5(pseudoClass, name, argument, compound, namespaces);
        }
    }

    private applySelectors5(pseudoClass: PseudoClassSelector, name: string, argument: CssNode | null, compound: MutableCompound, namespaces: ReadonlyMap<string, string>): Specificity {
        switch (name) {
            case "nth-col":
            case "nth-last-col": {
                // Selectors 5 §8.2 and §8.3: :nth-col( An+B ) and :nth-last-col( An+B ) count the columns of the cell's table.
                const expression: AnPlusB | undefined = this.anPlusBParser.parse(this.argumentText(pseudoClass));
                if (expression === undefined) {
                    throw new InvalidSelector();
                }
                compound.nth = compound.nth ?? [];
                compound.nth.push({ kind: name === "nth-col" ? "col" : "last-col", expression });
                return [0, 1, 0];
            }
            case "local-link": {
                // Selectors 5 §2.1: :local-link( <integer> ) with a non-negative integer, the number of path levels to match.
                const levels: string = this.argumentText(pseudoClass).trim();
                if (!/^\d+$/.test(levels)) {
                    throw new InvalidSelector();
                }
                compound.localLinks = compound.localLinks ?? [];
                compound.localLinks.push(Number(levels));
                return [0, 1, 0];
            }
            case "current":
                // Selectors 5 §5: without a timeline defined for an element, the time-dimensional pseudo-classes must not match it.
                this.compoundList(this.argumentText(pseudoClass), namespaces);
                break;
            case "state":
                // Selectors 5 §6: host languages define how :state( <ident> ) matches.
                if (!this.isIdentifier(this.argumentText(pseudoClass))) {
                    throw new InvalidSelector();
                }
                break;
            case "heading":
                // Selectors 5 §7: :heading( <level># ), levels as defined by the document language.
                if (!this.isLevelList(this.argumentText(pseudoClass))) {
                    throw new InvalidSelector();
                }
                break;
            default: {
                const kind: NthKind | undefined = NTH_KINDS.get(name);
                if (kind === undefined || argument === null || argument.type !== "Nth") {
                    throw new InvalidSelector();
                }
                return this.applyNth(kind, argument, compound, namespaces);
            }
        }
        compound.never = true;
        return [0, 1, 0];
    }

    private applyNth(kind: NthKind, nth: Nth, compound: MutableCompound, namespaces: ReadonlyMap<string, string>): Specificity {
        let of: Array<ReadonlyArray<CompiledSelectorStep>> | undefined;
        const specificity: Specificity = [0, 1, 0];
        if (nth.selector !== null) {
            if (kind !== "child" && kind !== "last-child") {
                throw new InvalidSelector();
            }
            const alternatives: Array<Compiled> = this.selectorList(nth.selector, namespaces, false, false, false);
            of = alternatives.map((alternative: Compiled) => alternative.steps);
            this.addSpecificity(specificity, this.highestOf(alternatives));
        }
        compound.nth = compound.nth ?? [];
        compound.nth.push(of === undefined ? { kind, expression: this.anPlusB(nth) } : { kind, expression: this.anPlusB(nth), of });
        return specificity;
    }

    private compoundList(text: string, namespaces: ReadonlyMap<string, string>): void {
        let list: CssNode;
        try {
            list = parse(text, { context: "selectorList" });
        } catch {
            throw new InvalidSelector();
        }
        for (const alternative of this.selectorList(list, namespaces, false, false, false)) {
            if (alternative.steps.length !== 1) {
                throw new InvalidSelector();
            }
        }
    }

    private selectorList(list: CssNode | null, namespaces: ReadonlyMap<string, string>, relative: boolean, forgiving: boolean,
        exempt: boolean): Array<Compiled> {
        // Selectors 4 §16.1: in the forgiving lists of :is() and :where() an invalid selector is dropped instead of invalidating the rule.
        if (list === null || list.type !== "SelectorList") {
            if (forgiving) {
                return [];
            }
            throw new InvalidSelector();
        }
        const compiled: Array<Compiled> = [];
        for (const item of list.children) {
            if (item.type !== "Selector") {
                if (forgiving) {
                    continue;
                }
                throw new InvalidSelector();
            }
            try {
                const alternative: Compiled = this.compileSelector(item, namespaces, relative, exempt);
                if (alternative.pseudoElement !== undefined) {
                    throw new InvalidSelector();
                }
                compiled.push(alternative);
            } catch (error) {
                if (!forgiving || !(error instanceof InvalidSelector)) {
                    throw error;
                }
            }
        }
        if (compiled.length === 0 && !forgiving) {
            throw new InvalidSelector();
        }
        return compiled;
    }

    private leadingLink(list: CssNode | null, index: number, namespaces: ReadonlyMap<string, string>): Link {
        const selector: CssNode | undefined = list !== null && list.type === "SelectorList" ? list.children.toArray()[index] : undefined;
        const first: CssNode | null = selector !== undefined && selector.type === "Selector" ? selector.children.first : null;
        return first !== null && first.type === "Combinator" ? this.link(first.name, namespaces) : { combinator: "descendant" };
    }

    private anPlusB(nth: Nth): AnPlusB {
        const expression: Nth["nth"] = nth.nth;
        if (expression.type === "Identifier") {
            const keyword: string = this.asciiCase.foldLower(expression.name);
            if (keyword === "odd") {
                return { a: 2, b: 1 };
            }
            if (keyword === "even") {
                return { a: 2, b: 0 };
            }
            throw new InvalidSelector();
        }
        return { a: expression.a === null ? 0 : Number(expression.a), b: expression.b === null ? 0 : Number(expression.b) };
    }

    private languageRanges(pseudoClass: PseudoClassSelector): Array<string> {
        const ranges: Array<string> = [];
        if (pseudoClass.children === null) {
            throw new InvalidSelector();
        }
        for (const child of pseudoClass.children) {
            if (child.type === "Identifier") {
                ranges.push(this.escaping.unescape(child.name));
            } else if (child.type === "String") {
                ranges.push(child.value);
            } else if (child.type !== "Operator" || child.value !== ",") {
                throw new InvalidSelector();
            }
        }
        if (ranges.length === 0) {
            throw new InvalidSelector();
        }
        return ranges;
    }

    private argumentText(component: PseudoClassSelector | PseudoElementSelector): string {
        const first: CssNode | null = component.children === null ? null : component.children.first;
        if (first !== null && first.type === "Raw") {
            return first.value;
        }
        if (first !== null && first.type === "Identifier") {
            return first.name;
        }
        throw new InvalidSelector();
    }

    private significantTokens(text: string): Array<{ type: number; text: string }> {
        const tokens: Array<{ type: number; text: string }> = [];
        tokenize(text, (type: number, start: number, end: number) => {
            if (type !== tokenTypes.WhiteSpace && type !== tokenTypes.Comment) {
                tokens.push({ type, text: text.substring(start, end) });
            }
        });
        return tokens;
    }

    private isIdentifier(text: string): boolean {
        const tokens: Array<{ type: number; text: string }> = this.significantTokens(text);
        return tokens.length === 1 && tokens[0].type === tokenTypes.Ident;
    }

    private customIdent(text: string): string | undefined {
        // CSS Values 4 §4.2: a <custom-ident> is any identifier except the CSS-wide keywords and default.
        const tokens: Array<{ type: number; text: string }> = this.significantTokens(text);
        if (tokens.length !== 1 || tokens[0].type !== tokenTypes.Ident) {
            return undefined;
        }
        const name: string = this.escaping.unescape(tokens[0].text);
        return DeclarationReader.RESERVED_IDENTIFIERS.has(this.asciiCase.foldLower(name)) ? undefined : name;
    }

    private isLevelList(text: string): boolean {
        // A <level> is a <number-token> with its type flag set to "integer", and levels are separated by commas.
        const tokens: Array<{ type: number; text: string }> = this.significantTokens(text);
        if (tokens.length === 0 || tokens.length % 2 === 0) {
            return false;
        }
        return tokens.every((token: { type: number; text: string }, index: number) =>
            index % 2 === 0 ? token.type === tokenTypes.Number && /^[+-]?\d+$/.test(token.text) : token.type === tokenTypes.Comma);
    }

    private typeMatcher(rawName: string, namespaces: ReadonlyMap<string, string>): TypeMatcher {
        // An escaped "|" is identifier data, not the namespace separator (CSS Syntax 3 §4.3.12).
        const pipe: number = this.escaping.rawPipeIndex(rawName);
        if (pipe === -1) {
            const name: string = this.escaping.unescape(rawName);
            const defaultUri: string | undefined = namespaces.get(SelectorCompiler.DEFAULT_NAMESPACE);
            const namespace: NamespaceConstraint = defaultUri === undefined ? { kind: "any" } : this.uriConstraint(defaultUri);
            return name === "*" ? { kind: "any", namespace } : { kind: "localName", name, namespace };
        }
        const namespace: NamespaceConstraint = this.namespaceConstraint(this.escaping.unescape(rawName.slice(0, pipe)), namespaces);
        const localName: string = this.escaping.unescape(rawName.slice(pipe + 1));
        return localName === "*" ? { kind: "any", namespace } : { kind: "localName", name: localName, namespace };
    }

    private namespaceConstraint(prefix: string, namespaces: ReadonlyMap<string, string>): NamespaceConstraint {
        // Selectors 4 §3.9: a simple selector containing an undeclared namespace prefix is invalid.
        if (prefix === "*") {
            return { kind: "any" };
        }
        if (prefix === "") {
            return { kind: "none" };
        }
        const uri: string | undefined = namespaces.get(prefix);
        if (uri === undefined) {
            throw new InvalidSelector();
        }
        return this.uriConstraint(uri);
    }

    private uriConstraint(uri: string): NamespaceConstraint {
        return uri === "" ? { kind: "none" } : { kind: "uri", uri };
    }

    private attributeMatcher(attribute: AttributeSelector, namespaces: ReadonlyMap<string, string>): AttributeMatcher {
        if (attribute.matcher !== null && !ATTRIBUTE_OPERATORS.has(attribute.matcher)) {
            throw new InvalidSelector();
        }
        const flags: string | undefined = attribute.flags === null ? undefined : this.asciiCase.foldLower(attribute.flags);
        if (flags !== undefined && flags !== "i" && flags !== "s") {
            throw new InvalidSelector();
        }
        const rawName: string = attribute.name.name;
        const pipe: number = this.escaping.rawPipeIndex(rawName);
        // Selectors 4 §6.4: an attribute selector without a prefix matches only attributes in no namespace.
        const name: string = this.escaping.unescape(pipe === -1 ? rawName : rawName.slice(pipe + 1));
        const namespace: NamespaceConstraint = pipe === -1 ? { kind: "none" } : this.namespaceConstraint(this.escaping.unescape(rawName.slice(0, pipe)), namespaces);
        const caseInsensitive: boolean = flags === "i";
        if (attribute.value === null) {
            return { name, namespace, caseInsensitive };
        }
        const raw: string = attribute.value.type === "String" ? attribute.value.value : this.escaping.unescape(attribute.value.name);
        return { name, namespace, operator: attribute.matcher as AttributeOperator, value: caseInsensitive ? this.asciiCase.foldLower(raw) : raw, caseInsensitive };
    }

    private highestOf(alternatives: ReadonlyArray<Compiled>): Specificity {
        return this.highest(alternatives.map((alternative: Compiled) => alternative.specificity));
    }

    private highest(specificities: ReadonlyArray<Specificity>): Specificity {
        let highest: Specificity = NO_SPECIFICITY;
        for (const candidate of specificities) {
            if (candidate[0] > highest[0] || (candidate[0] === highest[0] && (candidate[1] > highest[1] || (candidate[1] === highest[1] && candidate[2] > highest[2])))) {
                highest = candidate;
            }
        }
        return [highest[0], highest[1], highest[2]];
    }

    private addSpecificity(target: Specificity, addition: Specificity): void {
        target[0] += addition[0];
        target[1] += addition[1];
        target[2] += addition[2];
    }

    private emptyCompound(): MutableCompound {
        return {
            type: { kind: "any", namespace: { kind: "any" } }, explicitType: false, never: false
        };
    }
}
