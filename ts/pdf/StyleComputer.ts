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

import type { Declaration as CssTreeDeclaration, Value } from "css-tree";
import { parse } from "css-tree";
import { AsciiCase } from "../css/AsciiCase.js";
import type { TriState } from "../css/ConditionEvaluator.js";
import { DeclarationReader } from "../css/DeclarationReader.js";
import { LogicalProperties } from "../css/LogicalProperties.js";
import type { DescriptorDefinition, PropertyDefinition, PropertyTable } from "../css/PropertyTable.js";
import { ShorthandExpander } from "../css/ShorthandExpander.js";
import type {
    ContainerCondition, ContainerQuery, CssWideKeyword, Declaration, DeclaredValue, KeywordValue, ParsedValue, PendingSubstitution, PropertyRule, ToggleValue
} from "../css/Stylesheet.js";
import type { SyntaxComponent } from "../css/SyntaxDefinition.js";
import { SyntaxDefinition } from "../css/SyntaxDefinition.js";
import { CalcSimplifier } from "../css/values/CalcSimplifier.js";
import { ColorKeywords } from "../css/values/ColorKeywords.js";
import type { ParsedColor, ProfileColors } from "../css/values/ColorParser.js";
import { ColorParser } from "../css/values/ColorParser.js";
import type { BaseType, CalcNode, CssValue } from "../css/values/CssValue.js";
import { CssUnits } from "../css/values/CssUnits.js";
import { CssValueParser } from "../css/values/CssValueParser.js";
import { CssValueSerializer } from "../css/values/CssValueSerializer.js";
import type { SourceElement } from "../parse/SourceElement.js";
import { BaseUrls } from "./BaseUrls.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import type { DisplayType } from "./DisplayTypes.js";
import { DisplayTypes } from "./DisplayTypes.js";
import type { ContainerAxis, ZoomSource } from "./ElementUnits.js";
import { ElementUnits } from "./ElementUnits.js";
import { FontMatcher } from "./FontMatcher.js";
import type { FontMetrics } from "./FontMetrics.js";
import { LengthResolver } from "./LengthResolver.js";
import type { Size } from "./PageCanvas.js";
import type { CustomValue, SubstitutionHost, ValueSubstitution } from "./ValueSubstitution.js";

type LanguageValue = (property: string, value: CssValue, input: StyleInput, standard: (property: string) => CssValue | undefined, units: ElementUnits,
    parentSize: () => number) => CssValue | undefined;

interface AtRuleDescriptors {
    atRule: string;
    names: ReadonlyArray<string>;
}

export interface QueryContainer {
    element: SourceElement;
    style: ComputedStyle;
    parent?: ComputedStyle;
    root?: ComputedStyle;
    size?: Size;
}

export interface StyleInput {
    cascaded: ReadonlyMap<string, DeclaredValue>;
    parent?: ComputedStyle;
    root?: ComputedStyle;
    element?: SourceElement;
    pseudoElement?: string;
    viewport: Size;
    descriptors?: AtRuleDescriptors;
    containers: () => Iterable<QueryContainer>;
}

interface Resolution {
    input: StyleInput;
    cascaded: ReadonlyMap<string, DeclaredValue>;
    working: Record<string, CssValue>;
    toCompute: Set<string>;
    shared?: Map<string, string>;
    values?: Map<string, CssValue>;
    valueless?: Set<string>;
    custom?: Map<string, CustomValue | null>;
    replaced?: Map<PendingSubstitution, ReadonlyArray<Declaration> | CssWideKeyword>;
    invalid?: Set<PendingSubstitution>;
    stack?: Array<string>;
    cyclic?: Set<string>;
    owner?: number;
    zoom?: Zoom;
    host: SubstitutionHost;
}

interface Zoom {
    own: number;
    effective: number;
}

type Specified = { kind: "inherit" } | { kind: "initial" } | { kind: "value"; value: CssValue } | { kind: "toggle"; values: ReadonlyArray<ParsedValue | KeywordValue> };

type Phase = "font" | "line-height" | "other";

const PRIORITIES: ReadonlyMap<string, number> = new Map<string, number>([
    ["zoom", 0], ["writing-mode", 0], ["direction", 0], ["text-orientation", 0], ["font-size", 1], ["font-family", 2], ["font-style", 2], ["font-weight", 2],
    ["font-width", 2], ["font-optical-sizing", 2], ["font-size-adjust", 2.5], ["line-height", 3], ["position", 4], ["float", 5], ["display", 7]
]);
const FONT_SIZE_ADJUST: string = "font-size-adjust";
const NO_ADJUSTMENT: CssValue = { kind: "ident", name: "none", lower: "none" };
const FONT_PROPERTIES: ReadonlyArray<string> = ["font-size", "font-family", "font-style", "font-weight", "font-width", "font-optical-sizing"];
const FONT_UNITS: ReadonlySet<string> = new Set<string>(["em", "ex", "cap", "ch", "ic", "lh"]);
const ROOT_UNITS: ReadonlySet<string> = new Set<string>(["rem", "rex", "rcap", "rch", "ric", "rlh"]);
const LOGICAL_VIEWPORT_UNITS: RegExp = /^(?:(?:sv|lv|dv)?v|cq)[ib]$/;
const LINE_STYLES: ReadonlyMap<string, string> = new Map<string, string>([
    ["border-top-width", "border-top-style"], ["border-right-width", "border-right-style"], ["border-bottom-width", "border-bottom-style"],
    ["border-left-width", "border-left-style"], ["border-block-start-width", "border-block-start-style"], ["border-block-end-width", "border-block-end-style"],
    ["border-inline-start-width", "border-inline-start-style"], ["border-inline-end-width", "border-inline-end-style"]
]);
const RULE_WIDTHS: ReadonlySet<string> = new Set<string>(["column-rule-width", "row-rule-width"]);
const OVERFLOW_AXES: ReadonlyMap<string, string> = new Map<string, string>([
    ["overflow-x", "overflow-y"], ["overflow-y", "overflow-x"], ["overflow-block", "overflow-inline"], ["overflow-inline", "overflow-block"]
]);
const MEDIUM: number = 16;
const SIZE_FACTORS: ReadonlyMap<string, number> = new Map<string, number>([
    ["xx-small", 3 / 5], ["x-small", 3 / 4], ["small", 8 / 9], ["medium", 1], ["large", 6 / 5], ["x-large", 3 / 2], ["xx-large", 2], ["xxx-large", 3]
]);
const RELATIVE_SIZE_RATIO: number = 1.2;
const LINE_WIDTHS: ReadonlyMap<string, number> = new Map<string, number>([["thin", 1], ["medium", 3], ["thick", 5]]);
const COLOR_FUNCTIONS: ReadonlySet<string> = new Set<string>([
    "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "alpha", "color-mix", "contrast-color", "device-cmyk",
    "ictcp", "jzazbz", "jzczhz", "color-hdr"
]);
const TRANSPARENT_IMAGE: CssValue = {
    kind: "function", name: "image", args: [{ kind: "color", space: "srgb", components: [0, 0, 0], alpha: 0, legacy: true }]
};
const CANONICAL_TYPES: ReadonlySet<string> = new Set<string>(["angle", "time", "resolution"]);
const ZOOM: string = "zoom";
const PIXELS: string = "px";

export class StyleComputer {

    static readonly SIDES: ReadonlyArray<"top" | "right" | "bottom" | "left"> = ["top", "right", "bottom", "left"];
    static readonly NO_CONTAINERS: () => Iterable<QueryContainer> = (): Iterable<QueryContainer> => [];
    static readonly RELATIVE_SIZE_RATIO: number = RELATIVE_SIZE_RATIO;

    static input(cascaded: ReadonlyMap<string, DeclaredValue>, viewport: Size, containers: () => Iterable<QueryContainer>, parent?: ComputedStyle,
        root?: ComputedStyle, element?: SourceElement, pseudoElement?: string, descriptors?: AtRuleDescriptors): StyleInput {
        const input: StyleInput = { cascaded, viewport, containers };
        if (parent !== undefined) {
            input.parent = parent;
        }
        if (root !== undefined) {
            input.root = root;
        }
        if (element !== undefined) {
            input.element = element;
        }
        if (pseudoElement !== undefined) {
            input.pseudoElement = pseudoElement;
        }
        if (descriptors !== undefined) {
            input.descriptors = descriptors;
        }
        return input;
    }

    private readonly table: PropertyTable;
    private readonly metrics: FontMetrics;
    private readonly substitution: ValueSubstitution;
    private readonly registered: ReadonlyMap<string, PropertyRule>;
    private readonly language?: LanguageValue;
    private readonly languageProperties?: ReadonlySet<string>;
    private readonly expander: ShorthandExpander;
    private readonly reader: DeclarationReader;
    private readonly lengths: LengthResolver = new LengthResolver();
    private readonly parser: CssValueParser = new CssValueParser();
    private readonly colors: ColorParser;
    private readonly keywords: ColorKeywords = new ColorKeywords();
    private readonly simplifier: CalcSimplifier = new CalcSimplifier();
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly definitions: SyntaxDefinition = new SyntaxDefinition();
    private readonly serializer: CssValueSerializer = new CssValueSerializer();
    private readonly units: CssUnits = new CssUnits();
    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly logical: LogicalProperties;
    private readonly initialValues: Map<string, CssValue> = new Map<string, CssValue>();
    private noInitial?: Set<string>;
    private readonly registeredInitials: Map<string, CustomValue | null> = new Map<string, CustomValue | null>();
    private readonly colorProperties: Map<string, boolean> = new Map<string, boolean>();
    private readonly cycleKeys: Map<string, string> = new Map<string, string>();
    private readonly sharesCustom: boolean;
    viewportUsed: boolean = false;
    private initialStyle?: ComputedStyle;
    private initialResolution?: Resolution;
    private anchorOwners: number = 0;
    private inheritedNames?: ReadonlyArray<string>;
    private initialLengths?: ReadonlyArray<string>;

    constructor(table: PropertyTable, metrics: FontMetrics, substitution: ValueSubstitution, registered: ReadonlyMap<string, PropertyRule>,
        profiles: ProfileColors, language?: LanguageValue, languageProperties?: ReadonlySet<string>) {
        this.table = table;
        this.colors = new ColorParser(profiles);
        if (language !== undefined && languageProperties !== undefined) {
            this.language = language;
            this.languageProperties = languageProperties;
        }
        this.metrics = metrics;
        this.substitution = substitution;
        this.registered = registered;
        this.expander = new ShorthandExpander(table);
        this.reader = new DeclarationReader(table);
        this.logical = new LogicalProperties(table);
        this.sharesCustom = [...registered.values()].every((rule: PropertyRule) => rule.inherits);
    }

    initial(): ComputedStyle {
        // CSS Cascade 5 §7.1: the initial value of every longhand; it also stands in for the parent of the root (CSS Values 4 §6.1.1).
        if (this.initialStyle === undefined) {
            const values: Record<string, CssValue> = {};
            const input: StyleInput = { cascaded: new Map<string, DeclaredValue>(), viewport: { width: 0, height: 0 }, containers: StyleComputer.NO_CONTAINERS };
            const resolution: Resolution = this.resolution(input, values, new Set<string>());
            this.initialResolution = resolution;
            const longhands: Array<string> = [...this.table.names()].filter((name: string) => !this.expander.isShorthand(name));
            for (const property of this.ordered(longhands)) {
                const value: CssValue | undefined = this.initialComputed(property, resolution, this.phase(property));
                if (value !== undefined) {
                    values[property] = value;
                }
            }
            this.initialStyle = { values, inherited: values, custom: {} };
        }
        return this.initialStyle;
    }

    attributeLength(text: string, style: ComputedStyle, input: StyleInput): CssValue | undefined {
        // An attribute that holds a <length-percentage> computed as a length property of the element would be, with the
        // element's own font for the font-relative units; a percentage stays for layout to resolve.
        let value: CssValue | undefined;
        try {
            value = this.parser.parse(parse(text, { context: "value" }) as Value);
        } catch {
            return undefined;
        }
        if (value === undefined || value.kind === "percentage") {
            return value;
        }
        const resolution: Resolution = this.resolution(input, Object.create(style.values) as Record<string, CssValue>, new Set<string>());
        return this.lengths.compute(value, this.elementUnits(resolution, "other"));
    }

    compute(input: StyleInput): ComputedStyle {
        // An element computes the properties it declares and those that depend on them, each when it is first needed; every
        // other value comes from its parent's inherited values or from the initial values, through the prototype chain.
        const parentLayer: Readonly<Record<string, CssValue>> = input.parent?.inherited ?? this.initial().values;
        const working: Record<string, CssValue> = Object.create(parentLayer) as Record<string, CssValue>;
        const resolution: Resolution = this.resolution(input, working, new Set<string>(this.propertiesToCompute(input)));
        this.pairLogical(resolution);
        const custom: Readonly<Record<string, CustomValue>> = this.customProperties(resolution);
        const zoom: number = this.zoomLayer(resolution);
        for (const property of this.ordered([...resolution.toCompute])) {
            this.standard(property, resolution);
        }
        if (resolution.values === undefined) {
            return zoom === 1 ? { values: parentLayer, inherited: parentLayer, custom } : { values: parentLayer, inherited: parentLayer, custom, zoom };
        }
        let inheritedOwn: Record<string, CssValue> | undefined;
        let own: Record<string, CssValue> | undefined;
        for (const [property, value] of resolution.values) {
            if (this.isDescriptor(property, input) || this.definition(property)?.inherited !== true) {
                own = own ?? {};
                own[property] = value;
            } else {
                inheritedOwn = inheritedOwn ?? {};
                inheritedOwn[property] = value;
            }
        }
        const inherited: Readonly<Record<string, CssValue>> = inheritedOwn === undefined ? parentLayer : Object.assign(Object.create(parentLayer) as Record<string, CssValue>, inheritedOwn);
        const values: Readonly<Record<string, CssValue>> = own === undefined ? inherited : Object.assign(Object.create(inherited) as Record<string, CssValue>, own);
        const style: ComputedStyle = resolution.owner === undefined ? { values, inherited, custom } : { values, inherited, custom, anchorOwner: resolution.owner };
        if (zoom !== 1) {
            style.zoom = zoom;
        }
        return style;
    }

    private zoomOf(resolution: Resolution): Zoom {
        // CSS Viewport 1 (Editor's Draft) §4: the effective zoom is the product of the element's zoom and those of its
        // ancestors, a zero zoom is treated as one, and only elements are zoomed.
        if (resolution.zoom === undefined) {
            const input: StyleInput = resolution.input;
            const value: CssValue | undefined = input.element === undefined ? undefined : this.standard(ZOOM, resolution);
            const own: number = value !== undefined && value.kind === "number" && value.value > 0 ? value.value : 1;
            resolution.zoom = { own, effective: input.element === undefined ? 1 : own * (input.parent?.zoom ?? 1) };
        }
        return resolution.zoom;
    }

    private zoomLayer(resolution: Resolution): number {
        // §4: the used value of every length "is pre-multiplied" by the effective zoom. The inherited values already carry the
        // zoom of the parent, so they take the element's own zoom; the initial values carry none and take the effective one.
        const zoom: Zoom = this.zoomOf(resolution);
        if (zoom.own !== 1) {
            this.zoomProperties(this.inheritedProperties(), zoom.own, resolution);
        }
        if (zoom.effective !== 1) {
            this.zoomProperties(this.initialLengthProperties(), zoom.effective, resolution);
        }
        return zoom.effective;
    }

    private zoomProperties(properties: ReadonlyArray<string>, factor: number, resolution: Resolution): void {
        for (const property of properties) {
            const value: CssValue | undefined = resolution.toCompute.has(property) || resolution.values?.has(property) === true ? undefined : resolution.working[property];
            if (value !== undefined && this.holdsLength(value)) {
                this.keep(property, resolution, this.zoomed(value, factor));
            }
        }
    }

    private inheritedProperties(): ReadonlyArray<string> {
        if (this.inheritedNames === undefined) {
            this.inheritedNames = Object.keys(this.initial().values).filter((property: string) => this.definition(property)?.inherited === true);
        }
        return this.inheritedNames;
    }

    private initialLengthProperties(): ReadonlyArray<string> {
        if (this.initialLengths === undefined) {
            const values: Readonly<Record<string, CssValue>> = this.initial().values;
            this.initialLengths = Object.keys(values).filter((property: string) => this.definition(property)?.inherited !== true && this.holdsLength(values[property]));
        }
        return this.initialLengths;
    }

    private holdsLength(value: CssValue): boolean {
        switch (value.kind) {
            case "length":
                return value.px !== 0;
            case "calc":
                return true;
            case "list":
                return value.items.some((item: CssValue) => this.holdsLength(item));
            case "function":
                return value.args.some((argument: CssValue) => this.holdsLength(argument));
            case "block":
                return value.content !== undefined && this.holdsLength(value.content);
            default:
                return false;
        }
    }

    private zoomed(value: CssValue, factor: number): CssValue {
        switch (value.kind) {
            case "length":
                return { kind: "length", px: value.px * factor };
            case "calc":
                return { kind: "calc", root: this.zoomedNode(value.root, factor) };
            case "list":
                return { kind: "list", separator: value.separator, items: value.items.map((item: CssValue) => this.zoomed(item, factor)) };
            case "function":
                return { kind: "function", name: value.name, args: value.args.map((argument: CssValue) => this.zoomed(argument, factor)) };
            case "block":
                return value.content === undefined ? value : { kind: "block", bracket: value.bracket, content: this.zoomed(value.content, factor) };
            default:
                return value;
        }
    }

    private zoomedNode(node: CalcNode, factor: number): CalcNode {
        if (node.kind === "leaf") {
            return node.unit === PIXELS ? { kind: "leaf", value: node.value * factor, unit: PIXELS } : node;
        }
        if (node.kind === "channel") {
            return node;
        }
        if (node.kind === "anchor") {
            return node.fallback === undefined ? node : { ...node, fallback: this.zoomedNode(node.fallback, factor) };
        }
        const children: Array<CalcNode> = node.children.map((child: CalcNode) => this.zoomedNode(child, factor));
        return node.kind === "round" ? { kind: "round", strategy: node.strategy, children } : { kind: "operation", operator: node.operator, children };
    }

    private inheritedValue(property: string, resolution: Resolution, phase: Phase): CssValue | undefined {
        // The parent's value carries the parent's zoom, and the element adds its own.
        const parent: CssValue | undefined = resolution.input.parent?.values[property];
        if (parent === undefined) {
            return this.initialComputed(property, resolution, phase);
        }
        const own: number = this.zoomOf(resolution).own;
        return own === 1 ? parent : this.zoomed(parent, own);
    }

    private pairLogical(resolution: Resolution): void {
        // CSS Logical 1 §4: a flow-relative property and the physical one the element's writing mode pairs it with share a
        // computed value, from whichever of their declarations wins the cascade; the cascade lists them in increasing precedence.
        const order: Array<string> = [...resolution.cascaded.keys()];
        if (!order.some((property: string) => this.logical.isGrouped(property))) {
            return;
        }
        const keyword: (property: string, fallback: string) => string = (property: string, fallback: string): string => {
            const value: CssValue | undefined = this.standard(property, resolution);
            return value !== undefined && value.kind === "ident" ? value.lower : fallback;
        };
        const mode: string = keyword("writing-mode", "horizontal-tb");
        // CSS Writing Modes 4 §5.1: upright typesetting in a vertical writing mode makes the used direction ltr.
        const direction: string = mode !== "horizontal-tb" && keyword("text-orientation", "mixed") === "upright" ? "ltr" : keyword("direction", "ltr");
        const ranks: Map<string, number> = new Map<string, number>(order.map((property: string, index: number): [string, number] => [property, index]));
        for (const [logical, physical] of this.logical.pairs(mode, direction)) {
            const logicalRank: number | undefined = ranks.get(logical);
            const physicalRank: number | undefined = ranks.get(physical);
            if (logicalRank === undefined && physicalRank === undefined) {
                continue;
            }
            const logicalWins: boolean = physicalRank === undefined || (logicalRank !== undefined && logicalRank > physicalRank);
            resolution.shared = resolution.shared ?? new Map<string, string>();
            resolution.shared.set(logicalWins ? physical : logical, logicalWins ? logical : physical);
            resolution.toCompute.add(logical);
            resolution.toCompute.add(physical);
        }
        for (const [width, style] of LINE_STYLES) {
            if (resolution.toCompute.has(style)) {
                resolution.toCompute.add(width);
            }
        }
    }

    containersHold(queries: ReadonlyArray<ContainerQuery>, containers: () => Iterable<QueryContainer>, viewport: Size): boolean {
        // CSS Conditional 5 §5.4: a query "is true if any of its component <container-condition>s are true, and false only if
        // all" are false; a rule applies when all its queries are true, and a negated unknown query stays unknown.
        return queries.every((query: ContainerQuery) => {
            const states: Array<TriState> = query.conditions.map((condition: ContainerCondition) => this.containerCondition(condition, containers, viewport));
            const state: TriState = states.includes("true") ? "true" : (states.every((item: TriState) => item === "false") ? "false" : "unknown");
            return query.negated ? state === "false" : state === "true";
        });
    }

    private containerCondition(condition: ContainerCondition, containers: () => Iterable<QueryContainer>, viewport: Size): TriState {
        // CSS Conditional 5 §5.4: the nearest ancestor with the name that is "a valid query container for all the container
        // features" is selected, so for size features one that accepts size queries on their axes; with none it is unknown.
        const axes: Array<ContainerAxis> | undefined = condition.query === undefined ? undefined : this.substitution.sizeAxes(condition.query);
        let selected: QueryContainer | undefined;
        for (const container of containers()) {
            if ((condition.name === undefined || this.containerNames(container.style)?.includes(condition.name) === true)
                && (axes === undefined || axes.every((axis: ContainerAxis) => this.acceptsAxis(container, axis)))) {
                selected = container;
                break;
            }
        }
        if (selected === undefined) {
            return "unknown";
        }
        if (condition.query === undefined) {
            return "true";
        }
        return this.substitution.containerQuery(condition.query, this.containerHost(selected, viewport), this.isHorizontal(selected.style.values), selected.size);
    }

    private containerNames(style: ComputedStyle): Array<string> | undefined {
        const value: CssValue | undefined = style.values["container-name"];
        if (value === undefined) {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        return items.filter((item: CssValue) => item.kind === "ident" && item.lower !== "none").map((item: CssValue) => (item as { name: string }).name);
    }

    private containerTypes(style: ComputedStyle): Array<string> | undefined {
        const value: CssValue | undefined = style.values["container-type"];
        if (value === undefined) {
            return undefined;
        }
        const types: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        return types.filter((type: CssValue) => type.kind === "ident").map((type: CssValue) => (type as { lower: string }).lower);
    }

    private containerHost(container: QueryContainer, viewport: Size): SubstitutionHost {
        // The container's style is already computed: its values and custom properties are read, and a queried value is computed
        // as it would be on the container.
        const initial: ComputedStyle = this.initial();
        const parent: ComputedStyle = {
            values: container.parent?.values ?? initial.values, inherited: container.parent?.inherited ?? initial.inherited, custom: container.style.custom
        };
        if (container.parent?.zoom !== undefined) {
            parent.zoom = container.parent.zoom;
        }
        const input: StyleInput = StyleComputer.input(new Map<string, DeclaredValue>(), viewport, StyleComputer.NO_CONTAINERS, parent, container.root, container.element,
            undefined, undefined);
        const resolution: Resolution = this.resolution(input, Object.create(container.style.values) as Record<string, CssValue>, new Set<string>());
        for (const [name, value] of Object.entries(container.style.custom)) {
            resolution.custom = resolution.custom ?? new Map<string, CustomValue | null>();
            resolution.custom.set(name, value);
        }
        return resolution.host;
    }

    private resolution(input: StyleInput, working: Record<string, CssValue>, toCompute: Set<string>): Resolution {
        this.metrics.unsettled(working);
        const resolution: Resolution = {
            input, cascaded: input.cascaded, working, toCompute, host: undefined as unknown as SubstitutionHost
        };
        resolution.host = {
            custom: (name: string): CustomValue | null => this.customValue(name, resolution),
            inherited: (name: string): CustomValue | null => input.parent?.custom[name] ?? null,
            initialCustom: (name: string): CustomValue | null => this.registeredInitial(this.registered.get(name)),
            registration: (name: string): string | undefined => {
                const rule: PropertyRule | undefined = this.registered.get(name);
                return rule === undefined || rule.syntax === SyntaxDefinition.UNIVERSAL ? undefined : rule.syntax;
            },
            inherits: (name: string): boolean => this.registered.get(name)?.inherits ?? true,
            typed: (syntax: string, text: string, baseUrl: string): string | undefined => this.typedValue(syntax, text, baseUrl, resolution),
            matches: (property: string, value?: string): TriState => this.matches(property, resolution, value),
            numeric: (text: string): [number, string] | undefined => this.numeric(text, resolution),
            containersHold: (queries: ReadonlyArray<ContainerQuery>): boolean => this.containersHold(queries, input.containers, input.viewport),
            enter: (key: string): boolean => this.enter(key, resolution),
            leave: (key: string): boolean => this.leave(key, resolution)
        };
        if (input.element !== undefined) {
            resolution.host.element = input.element;
        }
        if (input.pseudoElement !== undefined) {
            resolution.host.pseudoElement = input.pseudoElement;
        }
        return resolution;
    }

    private cycleKey(property: string): string {
        let key: string | undefined = this.cycleKeys.get(property);
        if (key === undefined) {
            key = "property|" + property;
            this.cycleKeys.set(property, key);
        }
        return key;
    }

    private enter(key: string, resolution: Resolution): boolean {
        // CSS Variables 1 §2.3 and CSS Functions and Mixins §3.1: what depends on itself is in a cycle, and so is every member.
        const stack: Array<string> | undefined = resolution.stack;
        if (stack === undefined) {
            resolution.stack = [key];
            return true;
        }
        const index: number = stack.indexOf(key);
        if (index !== -1) {
            const cyclic: Set<string> = resolution.cyclic ?? new Set<string>();
            resolution.cyclic = cyclic;
            for (let member: number = index; member < stack.length; member++) {
                cyclic.add(stack[member]);
            }
            return false;
        }
        stack.push(key);
        return true;
    }

    private leave(key: string, resolution: Resolution): boolean {
        resolution.stack?.pop();
        return resolution.cyclic?.delete(key) === true;
    }

    private customProperties(resolution: Resolution): Readonly<Record<string, CustomValue>> {
        const input: StyleInput = resolution.input;
        const parentCustom: Readonly<Record<string, CustomValue>> = input.parent?.custom ?? {};
        const declares: boolean = [...resolution.cascaded.keys()].some((property: string) => property.startsWith("--"));
        if (!declares && this.sharesCustom && input.parent !== undefined) {
            return parentCustom;
        }
        const names: Set<string> = new Set<string>([...Object.keys(parentCustom), ...this.registered.keys()]);
        for (const name of resolution.cascaded.keys()) {
            if (name.startsWith("--")) {
                names.add(name);
            }
        }
        const result: Record<string, CustomValue> = {};
        for (const name of names) {
            const value: CustomValue | null = this.customValue(name, resolution);
            if (value !== null) {
                result[name] = value;
            }
        }
        return result;
    }

    private customValue(name: string, resolution: Resolution): CustomValue | null {
        const known: CustomValue | null | undefined = resolution.custom?.get(name);
        if (known !== undefined) {
            return known;
        }
        const key: string = this.cycleKey(name);
        if (!this.enter(key, resolution)) {
            return null;
        }
        const rule: PropertyRule | undefined = this.registered.get(name);
        let value: CustomValue | null = this.declaredCustom(name, resolution, rule);
        if (this.leave(key, resolution)) {
            value = this.invalidCustom(name, resolution, rule);
        }
        resolution.custom = resolution.custom ?? new Map<string, CustomValue | null>();
        resolution.custom.set(name, value);
        return value;
    }

    private declaredCustom(name: string, resolution: Resolution, rule?: PropertyRule): CustomValue | null {
        const declared: DeclaredValue | undefined = resolution.cascaded.get(name);
        if (declared === undefined) {
            return this.defaultCustom(name, resolution, rule);
        }
        if (declared.kind === "keyword") {
            return this.keywordCustom(name, declared.keyword, resolution, rule);
        }
        if (declared.kind !== "custom") {
            return this.invalidCustom(name, resolution, rule);
        }
        const typed: boolean = rule !== undefined && rule.syntax !== SyntaxDefinition.UNIVERSAL;
        const value: CustomValue | null = this.substitution.customValue(declared, name, typed, resolution.host);
        if (value === null) {
            return this.invalidCustom(name, resolution, rule);
        }
        // CSS Values 5 Appendix A: a value that is only a CSS-wide keyword after substitution acts as that keyword.
        const keyword: string = this.asciiCase.foldLower(value.text);
        if (DeclarationReader.CSS_WIDE_KEYWORDS.has(keyword)) {
            return this.keywordCustom(name, keyword as CssWideKeyword, resolution, rule);
        }
        if (rule === undefined || !typed) {
            return value;
        }
        // CSS Properties and Values 1 §2.4: a registered property computes by its syntax, or is invalid at computed-value time.
        const computed: string | undefined = this.typedValue(rule.syntax, value.text, declared.baseUrl, resolution);
        if (computed === undefined) {
            return this.invalidCustom(name, resolution, rule);
        }
        return value.base === undefined ? { text: computed } : { text: computed, base: value.base };
    }

    private keywordCustom(name: string, keyword: CssWideKeyword, resolution: Resolution, rule?: PropertyRule): CustomValue | null {
        if (keyword === "inherit" || (keyword === "unset" && (rule === undefined || rule.inherits))) {
            return resolution.input.parent?.custom[name] ?? this.registeredInitial(rule);
        }
        return this.registeredInitial(rule);
    }

    private defaultCustom(name: string, resolution: Resolution, rule?: PropertyRule): CustomValue | null {
        const inherits: boolean = rule === undefined || rule.inherits;
        return inherits ? (resolution.input.parent?.custom[name] ?? this.registeredInitial(rule)) : this.registeredInitial(rule);
    }

    private invalidCustom(name: string, resolution: Resolution, rule?: PropertyRule): CustomValue | null {
        // CSS Values 5 Appendix A: an unregistered property, or one with the universal syntax, becomes the guaranteed-invalid
        // value; another registered one acts as unset.
        if (rule === undefined || rule.syntax === SyntaxDefinition.UNIVERSAL) {
            return null;
        }
        return this.defaultCustom(name, resolution, rule);
    }

    private registeredInitial(rule?: PropertyRule): CustomValue | null {
        if (rule === undefined || rule.initialValue === undefined) {
            return null;
        }
        if (!this.registeredInitials.has(rule.name)) {
            this.initial();
            const text: string | undefined = rule.syntax === SyntaxDefinition.UNIVERSAL ? rule.initialValue
                : this.typedValue(rule.syntax, rule.initialValue, "about:blank", this.initialResolution as Resolution);
            this.registeredInitials.set(rule.name, text === undefined ? null : { text });
        }
        return this.registeredInitials.get(rule.name) ?? null;
    }

    private typedValue(syntax: string, text: string, baseUrl: string, resolution: Resolution): string | undefined {
        return this.typedText(syntax, text, baseUrl, (): ElementUnits => this.elementUnits(resolution, "other", false));
    }

    typedText(syntax: string, text: string, baseUrl: string, units: () => ElementUnits): string | undefined {
        // CSS Values 5 §3.3.1 and CSS Properties and Values 1 §2.4: the value is parsed with the first component that matches it
        // and computed as that type; a list computes each of its items.
        if (syntax === SyntaxDefinition.UNIVERSAL) {
            return text;
        }
        for (const component of this.definitions.components(syntax)) {
            if (!this.matchesGrammar(component.text, text)) {
                continue;
            }
            let value: CssValue | undefined;
            try {
                value = this.parser.parse(parse(text, { context: "value" }) as Value);
            } catch {
                return undefined;
            }
            if (value === undefined || this.parser.anchored(value)) {
                return undefined;
            }
            if (component.keyword) {
                return this.serializer.serialize(value);
            }
            const items: ReadonlyArray<CssValue> = component.multiplier !== "" && value.kind === "list" ? value.items : [value];
            const computed: Array<CssValue> = [];
            for (const item of items) {
                const result: CssValue | undefined = this.computeTyped(component, item, baseUrl, units);
                if (result === undefined) {
                    return undefined;
                }
                computed.push(result);
            }
            const list: CssValue = computed.length === 1 && component.multiplier === "" ? computed[0]
                : { kind: "list", separator: component.multiplier === "#" ? "comma" : "space", items: computed };
            return this.serializer.serialize(list);
        }
        return undefined;
    }

    private computeTyped(component: SyntaxComponent, value: CssValue, baseUrl: string, units: () => ElementUnits): CssValue | undefined {
        // CSS Properties and Values 1 §2.4 computes each type as its own property does; the value carries no zoom, since the
        // properties it is substituted into apply their own element's.
        switch (component.name) {
            case "length":
            case "length-percentage":
                return this.lengths.compute(value, units());
            case "number":
                return this.computeGeneric(value, units(), false);
            case "integer": {
                const number: number | undefined = value.kind === "number" ? value.value : this.lengths.computeNumber(value, units());
                return number === undefined ? undefined : { kind: "number", value: Math.round(number), integer: true };
            }
            case "color":
                return this.computeGeneric(value, units(), true);
            case "url":
                return value.kind === "url" ? { kind: "url", href: this.absolute(value.href, baseUrl) } : value;
            case "image":
            case "transform-function":
            case "transform-list":
                return this.computeGeneric(this.absoluteUrls(value, baseUrl), units(), false);
            default:
                return CANONICAL_TYPES.has(component.name) ? this.canonical(value) : value;
        }
    }

    private canonical(value: CssValue): CssValue | undefined {
        if (value.kind === "dimension") {
            const base: BaseType | undefined = this.units.baseTypeOf(value.unit);
            const converted: number | undefined = this.units.toCanonical(value.value, value.unit);
            return base === undefined || converted === undefined ? undefined : { kind: "dimension", value: converted, unit: this.units.canonicalUnitOf(base) };
        }
        if (value.kind === "calc") {
            const root: CalcNode = this.simplifier.simplify(value.root, this.simplifier.specifiedContext());
            return root.kind === "leaf" ? { kind: "dimension", value: root.value, unit: root.unit } : { kind: "calc", root };
        }
        return value;
    }

    private absoluteUrls(value: CssValue, baseUrl: string): CssValue {
        switch (value.kind) {
            case "url":
                return { kind: "url", href: this.absolute(value.href, baseUrl) };
            case "function":
                return { kind: "function", name: value.name, args: value.args.map((argument: CssValue) => this.absoluteUrls(argument, baseUrl)) };
            case "list":
                return { kind: "list", separator: value.separator, items: value.items.map((item: CssValue) => this.absoluteUrls(item, baseUrl)) };
            default:
                return value;
        }
    }

    private absolute(href: string, baseUrl: string): string {
        // CSS Values 4 §4.5.1: a fragment-only URL stays as it is.
        if (href.length === 0 || href.startsWith("#")) {
            return href;
        }
        return BaseUrls.resolved(href, baseUrl) ?? href;
    }

    private matchesGrammar(grammar: string, text: string): boolean {
        try {
            return this.table.lexer.match(grammar, text).matched !== null;
        } catch {
            return false;
        }
    }

    private matches(property: string, resolution: Resolution, value?: string): TriState {
        // CSS Conditional 5 §6.2: a property matches when its computed value equals the given value computed for the same
        // element, a shorthand when each of its longhands does; without a value, when it differs from the initial value.
        const name: string = this.table.canonicalName(property);
        const longhands: ReadonlyArray<string> = this.expander.isShorthand(name) ? this.expander.longhands(name) : [name];
        if (!this.expander.isShorthand(name) && this.definition(name) === undefined) {
            return "unknown";
        }
        if (value === undefined) {
            const differs: boolean = longhands.some((longhand: string) =>
                JSON.stringify(this.standard(longhand, resolution)) !== JSON.stringify(this.initialComputed(longhand, resolution, this.phase(longhand))));
            return differs ? "true" : "false";
        }
        let declarations: Array<Declaration> | undefined;
        try {
            declarations = this.reader.read(parse(name + ": " + value, { context: "declaration" }) as CssTreeDeclaration, "about:blank", DeclarationReader.NO_NAMESPACES);
        } catch {
            return "false";
        }
        if (declarations === undefined) {
            return "false";
        }
        for (const declaration of declarations) {
            const expected: CssValue | undefined = this.declaredComputed(declaration, resolution);
            if (JSON.stringify(expected) !== JSON.stringify(this.standard(declaration.property, resolution))) {
                return "false";
            }
        }
        return "true";
    }

    private declaredComputed(declaration: Declaration, resolution: Resolution): CssValue | undefined {
        const property: string = declaration.property;
        const phase: Phase = this.phase(property);
        const value: DeclaredValue = declaration.value;
        const inherited: boolean = this.definition(property)?.inherited === true;
        if (value.kind === "value") {
            return this.computeValue(property, value.value, resolution, phase);
        }
        if (value.kind === "keyword" && (value.keyword === "inherit" || (value.keyword === "unset" && inherited))) {
            return this.inheritedValue(property, resolution, phase);
        }
        return value.kind === "keyword" ? this.initialComputed(property, resolution, phase) : undefined;
    }

    private numeric(text: string, resolution: Resolution): [number, string] | undefined {
        // CSS Conditional 5 §6.2: a <number>, <percentage>, <length>, <angle>, <time>, <frequency> or <resolution>, computed.
        let value: CssValue | undefined;
        try {
            value = this.parser.parse(parse(text, { context: "value" }) as Value);
        } catch {
            return undefined;
        }
        if (value === undefined) {
            return undefined;
        }
        const units: ElementUnits = this.elementUnits(resolution, "other", false);
        const computed: CssValue | undefined = value.kind === "calc" ? this.lengths.compute(value, units) ?? this.canonical(value) : value;
        switch (computed?.kind) {
            case "number":
                return [computed.value, "number"];
            case "percentage":
                return [computed.value, "percentage"];
            case "length":
                return [computed.px, "length"];
            case "dimension": {
                const length: CssValue | undefined = this.lengths.compute(computed, units);
                if (length !== undefined && length.kind === "length") {
                    return [length.px, "length"];
                }
                const base: BaseType | undefined = this.units.baseTypeOf(computed.unit);
                const converted: number | undefined = this.units.toCanonical(computed.value, computed.unit);
                return base === undefined || converted === undefined ? undefined : [converted, base];
            }
            case "calc": {
                const number: number | undefined = this.lengths.computeNumber(computed, units);
                return number === undefined ? undefined : [number, "number"];
            }
            default:
                return undefined;
        }
    }

    private propertiesToCompute(input: StyleInput): Array<string> {
        const properties: Set<string> = new Set<string>();
        for (const property of input.cascaded.keys()) {
            if (!property.startsWith("--")) {
                properties.add(property);
            }
        }
        // Values that depend on another property of the same element: line widths on their styles (CSS Borders 4 §2.3), float on
        // position and display on both (CSS 2.1 §9.7), overflow on its other axis, display on the root and on item containers.
        for (const [width, style] of LINE_STYLES) {
            if (properties.has(style)) {
                properties.add(width);
            }
        }
        if (properties.has("position")) {
            properties.add("float");
        }
        if ([...OVERFLOW_AXES.keys()].some((axis: string) => properties.has(axis))) {
            for (const axis of OVERFLOW_AXES.keys()) {
                properties.add(axis);
            }
        }
        if (properties.has("float") || properties.has("position") || properties.has("writing-mode") || this.isRoot(input) || this.blockifiesChildren(input)) {
            properties.add("display");
        }
        if (properties.has("display") && this.isInterCharacter(input.parent)) {
            properties.add("writing-mode");
        }
        const display: DeclaredValue | undefined = input.cascaded.get("display");
        if (display !== undefined && display.kind === "value" && this.displays.isRubyBox(this.displays.parse(display.value))) {
            properties.add("unicode-bidi");
        }
        if (input.descriptors !== undefined) {
            for (const descriptor of input.descriptors.names) {
                properties.add(descriptor);
            }
        }
        return [...properties];
    }

    private ordered(properties: ReadonlyArray<string>): Array<string> {
        const priority: (property: string) => number = (property: string): number => PRIORITIES.get(property) ?? (LINE_STYLES.has(property) ? 6 : 5);
        return [...properties].sort((first: string, second: string) => priority(first) - priority(second));
    }

    private phase(property: string): Phase {
        return FONT_PROPERTIES.includes(property) ? "font" : (property === "line-height" ? "line-height" : "other");
    }

    private standard(property: string, resolution: Resolution): CssValue | undefined {
        // A property is computed once, when first needed; one that takes part in a cycle of substitutions is invalid at
        // computed-value time (CSS Values 5 Appendix A) and acts as unset.
        const known: CssValue | undefined = resolution.values?.get(property);
        if (known !== undefined) {
            return known;
        }
        if (resolution.valueless?.has(property) === true) {
            return undefined;
        }
        if (!resolution.toCompute.has(property)) {
            return resolution.working[property];
        }
        const shared: string | undefined = resolution.shared?.get(property);
        if (shared !== undefined) {
            const value: CssValue | undefined = this.standard(shared, resolution);
            this.keep(property, resolution, value);
            return value;
        }
        const key: string = this.cycleKey(property);
        if (!this.enter(key, resolution)) {
            return resolution.working[property];
        }
        const phase: Phase = this.phase(property);
        let value: CssValue | undefined = this.computeProperty(property, resolution, phase);
        if (property === "writing-mode") {
            value = this.forcedWritingMode(resolution, value);
        }
        if (this.leave(key, resolution)) {
            const inherited: boolean = !this.isDescriptor(property, resolution.input) && this.definition(property)?.inherited === true;
            value = inherited ? resolution.input.parent?.values[property] ?? this.initialComputed(property, resolution, phase) : this.initialComputed(property, resolution, phase);
        }
        this.keep(property, resolution, value);
        return value;
    }

    private keep(property: string, resolution: Resolution, value?: CssValue): void {
        if (value === undefined) {
            resolution.valueless = resolution.valueless ?? new Set<string>();
            resolution.valueless.add(property);
            return;
        }
        resolution.values = resolution.values ?? new Map<string, CssValue>();
        resolution.values.set(property, value);
        resolution.working[property] = value;
    }

    private computeProperty(property: string, resolution: Resolution, phase: Phase): CssValue | undefined {
        const specified: Specified = this.specified(property, resolution);
        switch (specified.kind) {
            case "inherit":
                return this.inheritedValue(property, resolution, phase);
            case "initial":
                return this.initialComputed(property, resolution, phase);
            case "value":
                return this.computeValue(property, specified.value, resolution, phase) ?? this.initialComputed(property, resolution, phase);
            case "toggle":
                return this.computeToggle(property, specified.values, resolution, (value: CssValue) => this.computeValue(property, value, resolution, phase));
        }
    }

    private specifiedValue(property: string, resolution: Resolution): CssValue | undefined {
        // The value a property has before the rules of its own computation apply, for a property whose computed value
        // depends on this one while this one depends on it.
        const specified: Specified = this.specified(property, resolution);
        switch (specified.kind) {
            case "inherit":
                return resolution.input.parent?.values[property] ?? this.initialValue(property, resolution.input);
            case "initial":
                return this.initialValue(property, resolution.input);
            case "value":
                return specified.value;
            case "toggle":
                return this.computeToggle(property, specified.values, resolution, (value: CssValue) => value);
        }
    }

    private specified(property: string, resolution: Resolution): Specified {
        const input: StyleInput = resolution.input;
        const declared: DeclaredValue | undefined = resolution.cascaded.get(property);
        const inherited: boolean = !this.isDescriptor(property, input) && this.definition(property)?.inherited === true;
        if (declared === undefined) {
            return inherited ? { kind: "inherit" } : { kind: "initial" };
        }
        let value: DeclaredValue | ParsedValue | KeywordValue | ToggleValue | undefined = declared;
        if (declared.kind === "pending") {
            // CSS Values 5 Appendix A: a declaration invalid at computed-value time acts as unset.
            value = this.replaced(declared, property, resolution);
            if (value === undefined) {
                return inherited ? { kind: "inherit" } : { kind: "initial" };
            }
        }
        switch (value.kind) {
            case "value":
                return { kind: "value", value: value.value };
            case "toggle":
                return { kind: "toggle", values: value.values };
            case "keyword":
                if (value.keyword === "inherit" || (value.keyword !== "initial" && inherited)) {
                    return { kind: "inherit" };
                }
                return { kind: "initial" };
            default:
                return inherited ? { kind: "inherit" } : { kind: "initial" };
        }
    }

    private replaced(pending: PendingSubstitution, property: string, resolution: Resolution): ParsedValue | KeywordValue | ToggleValue | undefined {
        // The longhands of a shorthand share one substitution, so that a value drawn while applying the rule is the same in all.
        if (resolution.invalid?.has(pending) === true) {
            return undefined;
        }
        let result: ReadonlyArray<Declaration> | CssWideKeyword | undefined = resolution.replaced?.get(pending);
        if (result === undefined) {
            result = this.substitution.replace(pending, property, resolution.host, this.isDescriptor(property, resolution.input) ? resolution.input.descriptors?.atRule : undefined);
            if (result === undefined) {
                resolution.invalid = resolution.invalid ?? new Set<PendingSubstitution>();
                resolution.invalid.add(pending);
                return undefined;
            }
            resolution.replaced = resolution.replaced ?? new Map<PendingSubstitution, ReadonlyArray<Declaration> | CssWideKeyword>();
            resolution.replaced.set(pending, result);
        }
        if (typeof result === "string") {
            return { kind: "keyword", keyword: result };
        }
        const value: DeclaredValue | undefined = result.find((declaration: Declaration) => declaration.property === property)?.value;
        return value === undefined || value.kind === "pending" || value.kind === "custom" ? undefined : value;
    }

    private isDescriptor(property: string, input: StyleInput): boolean {
        return input.descriptors !== undefined && input.descriptors.names.includes(property);
    }

    private isRoot(input: StyleInput): boolean {
        return input.element !== undefined && input.pseudoElement === undefined && input.element.getParent() === undefined;
    }

    private blockifiesChildren(input: StyleInput): boolean {
        // CSS Flexbox 1 §4 and CSS Grid 2 §6.1: the children of a flex or grid container are blockified; CSS Display 3 §2.5: an
        // element with display: contents has no box, so its children are children of the box above it.
        for (const ancestor of input.containers()) {
            const display: DisplayType = this.displays.parse(ancestor.style.values["display"]);
            if (display.box !== "contents") {
                return this.displays.isItemContainer(display);
            }
        }
        return false;
    }

    private computeToggle(property: string, alternatives: ReadonlyArray<ParsedValue | KeywordValue>, resolution: Resolution,
        compute: (value: CssValue) => CssValue | undefined): CssValue | undefined {
        // CSS Values 5 §7.4: the value after the first one equal to the inherited value, or the first one.
        const parent: CssValue | undefined = resolution.input.parent?.values[property];
        const initialValue: CssValue | undefined = this.initialValue(property, resolution.input);
        const initial: CssValue | undefined = initialValue === undefined ? undefined : compute(initialValue);
        const inherited: string = JSON.stringify(parent ?? initial);
        let first: CssValue | undefined;
        let matched: boolean = false;
        for (const [index, alternative] of alternatives.entries()) {
            const value: CssValue | undefined = alternative.kind === "value" ? compute(alternative.value) : (alternative.keyword === "inherit" ? parent : initial);
            if (matched) {
                return value;
            }
            if (index === 0) {
                first = value;
            }
            matched = JSON.stringify(value) === inherited;
        }
        return first;
    }

    private initialComputed(property: string, resolution: Resolution, phase: Phase): CssValue | undefined {
        const initial: CssValue | undefined = this.initialValue(property, resolution.input);
        return initial === undefined ? undefined : this.computeValue(property, initial, resolution, phase);
    }

    private initialValue(property: string, input: StyleInput): CssValue | undefined {
        const atRule: string | undefined = this.isDescriptor(property, input) ? input.descriptors?.atRule : undefined;
        const key: string = (atRule === undefined ? "" : atRule + " ") + property;
        const known: CssValue | undefined = this.initialValues.get(key);
        if (known !== undefined || this.noInitial?.has(key) === true) {
            return known;
        }
        let text: string | undefined;
        if (atRule !== undefined) {
            const descriptor: DescriptorDefinition | undefined = this.table.descriptor(atRule, property);
            text = descriptor?.initial;
        } else if (property === "font-family") {
            // CSS Fonts 4 §2.1: the initial value depends on the user agent.
            text = FontMatcher.DEFAULT_FAMILY;
        } else {
            // An initial value written in prose, such as "depends on user agent", does not match the grammar and gives none.
            const initial: string | undefined = this.definition(property)?.initial;
            text = initial !== undefined && this.table.matchProperty(property, initial) !== undefined ? initial : undefined;
        }
        let value: CssValue | undefined;
        try {
            value = text === undefined ? undefined : this.parser.parse(parse(text, { context: "value" }) as Value);
        } catch {
            value = undefined;
        }
        if (value === undefined) {
            this.noInitial = this.noInitial ?? new Set<string>();
            this.noInitial.add(key);
        } else {
            this.initialValues.set(key, value);
        }
        return value;
    }

    private definition(property: string): PropertyDefinition | undefined {
        return this.table.definition(property);
    }

    private computeValue(property: string, value: CssValue, resolution: Resolution, phase: Phase): CssValue | undefined {
        const units: ElementUnits = this.elementUnits(resolution, phase);
        if (value.kind === "calc" && this.parser.anchored(value)) {
            const root: CalcNode | undefined = this.anchorComputed(value.root, resolution);
            return root === undefined ? undefined : this.computeGeneric({ kind: "calc", root }, units, false);
        }
        if (property !== "display") {
            const own: CssValue | undefined = this.languageValue(property, value, resolution, units);
            if (own !== undefined) {
                return own;
            }
        }
        switch (property) {
            case "font-size":
                return this.computeFontSize(value, units, resolution);
            case "math-depth":
                return this.computeMathDepth(value, units, resolution.input);
            case "font-weight":
                return this.computeFontWeight(value, resolution.input);
            case "font-width": {
                const percentage: number | undefined = value.kind === "ident" ? FontMatcher.WIDTH_KEYWORDS.get(value.lower) : undefined;
                return percentage === undefined ? (value.kind === "percentage" ? value : undefined) : { kind: "percentage", value: percentage };
            }
            case "font-style":
                return this.computeFontStyle(value);
            case FONT_SIZE_ADJUST:
                return this.computeFontSizeAdjust(value, resolution);
            case "text-combine-upright":
                // CSS Writing Modes 4 §9.1: the computed value is the "specified keyword, plus integer if digits", which is 2
                // when it is omitted.
                return value.kind === "ident" && value.lower === "digits" ? { kind: "list", separator: "space", items: [value, { kind: "number", value: 2, integer: true }] } : value;
            case "line-height":
                return this.computeLineHeight(value, units, resolution);
            case "display":
                return this.computeDisplay(value, resolution);
            case "unicode-bidi":
                return this.computeUnicodeBidi(value, resolution);
            case "float":
                return this.computeFloat(value, resolution);
            case "size":
                return this.computeSize(value, units);
            case "outline-width":
                // CSS UI 4 §3.2: an absolute length, whatever the outline style.
                return this.lineWidth(value, units);
            case "text-align-all":
            case "text-align-last":
                return this.computeTextAlign(property, value, resolution.input);
            case ZOOM:
                // CSS Viewport 1 (Editor's Draft) §4: "as specified, but with <percentage> converted to the equivalent <number>".
                return value.kind === "percentage" ? { kind: "number", value: value.value / 100, integer: false } : this.computeGeneric(value, units, false);
            default:
                break;
        }
        if (OVERFLOW_AXES.has(property)) {
            return this.computeOverflow(property, value, resolution);
        }
        if (RULE_WIDTHS.has(property)) {
            return this.lineWidths(value, units);
        }
        const style: string | undefined = LINE_STYLES.get(property);
        if (style !== undefined) {
            // CSS Borders 4 §2.3: thin, medium and thick are 1px, 3px and 5px, zero with the style none or hidden; the snapping of
            // CSS Values 4 §6 works in device pixels, and vector output has no device pixel grid to snap to.
            const lineStyle: CssValue | undefined = this.standard(style, resolution);
            if (lineStyle !== undefined && lineStyle.kind === "ident" && (lineStyle.lower === "none" || lineStyle.lower === "hidden")) {
                return { kind: "length", px: 0 };
            }
            return this.lineWidth(value, units);
        }
        return this.computeGeneric(value, units, this.takesColor(property));
    }

    private anchorComputed(root: CalcNode, resolution: Resolution): CalcNode | undefined {
        // CSS Anchor Positioning 1 §5.1.1: anchor-size() resolves only on an absolutely positioned box, where its length comes
        // from layout; elsewhere it is its fallback, or the declaration is invalid at computed-value time.
        const position: CssValue | undefined = this.standard("position", resolution);
        if (position !== undefined && position.kind === "ident" && (position.lower === "absolute" || position.lower === "fixed")) {
            if (resolution.owner === undefined) {
                this.anchorOwners++;
                resolution.owner = this.anchorOwners;
            }
            return this.lengths.owned(root, resolution.owner);
        }
        return this.lengths.anchored(root, (): number | undefined => undefined);
    }

    private computeOverflow(property: string, value: CssValue, resolution: Resolution): CssValue {
        // CSS Overflow 3 §3.1: "The visible/clip values of overflow compute to auto/hidden (respectively) if one of overflow-x
        // or overflow-y is neither visible nor clip." The other axis may be declared by its flow-relative or physical name.
        const keyword: string | undefined = value.kind === "ident" ? value.lower : undefined;
        if (keyword !== "visible" && keyword !== "clip") {
            return value;
        }
        const axis: string = OVERFLOW_AXES.get(property) as string;
        const other: CssValue | undefined = this.specifiedValue(resolution.shared?.get(axis) ?? axis, resolution);
        if (other === undefined || other.kind !== "ident" || other.lower === "visible" || other.lower === "clip") {
            return value;
        }
        const computed: string = keyword === "visible" ? "auto" : "hidden";
        return { kind: "ident", name: computed, lower: computed };
    }

    private computeTextAlign(property: string, value: CssValue, input: StyleInput): CssValue {
        // CSS Text 4 §7.1: match-parent computes to the parent's computed value, with start and end turned into left or right
        // by the parent's direction, and to start on the root element.
        if (value.kind !== "ident" || value.lower !== "match-parent") {
            return value;
        }
        const inherited: CssValue | undefined = input.parent?.values[property];
        if (input.parent === undefined || this.isRoot(input) || inherited === undefined) {
            return { kind: "ident", name: "start", lower: "start" };
        }
        if (inherited.kind !== "ident" || (inherited.lower !== "start" && inherited.lower !== "end")) {
            return inherited;
        }
        const direction: CssValue | undefined = input.parent.values["direction"];
        const rightToLeft: boolean = direction !== undefined && direction.kind === "ident" && direction.lower === "rtl";
        const side: string = (inherited.lower === "start") !== rightToLeft ? "left" : "right";
        return { kind: "ident", name: side, lower: side };
    }

    private lineWidth(value: CssValue, units: ElementUnits): CssValue | undefined {
        return value.kind === "ident" && LINE_WIDTHS.has(value.lower) ? { kind: "length", px: (LINE_WIDTHS.get(value.lower) as number) * units.absolute() } : this.lengths.compute(value, units);
    }

    private lineWidths(value: CssValue, units: ElementUnits): CssValue | undefined {
        // CSS Gaps 1 §4.3: a list of absolute lengths, the <line-width>s inside repeat() included; the repetition count and auto stay.
        switch (value.kind) {
            case "list": {
                const items: Array<CssValue> = [];
                for (const item of value.items) {
                    const computed: CssValue | undefined = this.lineWidths(item, units);
                    if (computed === undefined) {
                        return undefined;
                    }
                    items.push(computed);
                }
                return { kind: "list", separator: value.separator, items };
            }
            case "function": {
                const args: Array<CssValue> = [];
                for (const [index, argument] of value.args.entries()) {
                    const computed: CssValue | undefined = index === 0 ? argument : this.lineWidths(argument, units);
                    if (computed === undefined) {
                        return undefined;
                    }
                    args.push(computed);
                }
                return { kind: "function", name: value.name, args };
            }
            default:
                return this.lineWidth(value, units);
        }
    }

    private computeGeneric(value: CssValue, units: ElementUnits, colors: boolean): CssValue {
        // CSS Values 4 §6 and CSS Color 4 §4.4: lengths become absolute, percentages stay, and colors become computed colors.
        switch (value.kind) {
            case "number":
                return value;
            case "dimension":
                return this.lengths.compute(value, units) ?? value;
            case "calc":
                // CSS Values 4 §10.11: the calculation tree simplified, so an angle, time or resolution comes out as one value.
                return this.lengths.compute(value, units) ?? this.computedNumber(value, units) ?? this.canonical(value) ?? value;
            case "hash":
            case "ident":
                return colors ? this.color(value) : value;
            case "function":
                if (value.name === "light-dark" && value.args.length === 2) {
                    // CSS Color 5 §7: the first color or image with a light color scheme, where "The none keyword computes to
                    // image(transparent)". CSS Color Adjust 1 §2.1 requires no scheme, and a page for paper has the light one.
                    const light: CssValue = value.args[0];
                    return light.kind === "ident" && light.lower === "none" ? TRANSPARENT_IMAGE : this.computeGeneric(light, units, colors);
                }
                if (colors && COLOR_FUNCTIONS.has(value.name)) {
                    return this.color(this.schemeColors(value));
                }
                return { kind: "function", name: value.name, args: value.args.map((argument: CssValue) => this.computeGeneric(argument, units, colors)) };
            case "list":
                return { kind: "list", separator: value.separator, items: value.items.map((item: CssValue) => this.computeGeneric(item, units, colors)) };
            case "block":
                return value.content === undefined ? value : { kind: "block", bracket: value.bracket, content: this.computeGeneric(value.content, units, colors) };
            default:
                return value;
        }
    }

    private schemeColors(value: CssValue): CssValue {
        // A light-dark() inside another color function is replaced by its light color before that function is computed.
        switch (value.kind) {
            case "function":
                if (value.name === "light-dark" && value.args.length === 2) {
                    return this.schemeColors(value.args[0]);
                }
                return { kind: "function", name: value.name, args: value.args.map((argument: CssValue) => this.schemeColors(argument)) };
            case "list":
                return { kind: "list", separator: value.separator, items: value.items.map((item: CssValue) => this.schemeColors(item)) };
            default:
                return value;
        }
    }

    private computedNumber(value: CssValue, units: ElementUnits): CssValue | undefined {
        const number: number | undefined = value.kind === "calc" ? this.lengths.computeNumber(value, units) : undefined;
        return number === undefined ? undefined : { kind: "number", value: number, integer: Number.isInteger(number) };
    }

    private color(value: CssValue): CssValue {
        // CSS Color 4 §15.5: currentcolor computes to itself, and a system color to the color it stands for.
        const parsed: ParsedColor | undefined = this.colors.parse(value, this.simplifier.specifiedContext());
        if (parsed === undefined || parsed === "unresolved") {
            return value;
        }
        if (parsed.kind === "ident" && parsed.lower !== "currentcolor") {
            const hex: string | undefined = this.keywords.systemColorHex(parsed.lower);
            return (hex === undefined ? undefined : this.colors.parseHex(hex)) ?? parsed;
        }
        return parsed;
    }

    private takesColor(property: string): boolean {
        let takes: boolean | undefined = this.colorProperties.get(property);
        if (takes === undefined) {
            const grammar: string = this.definition(property)?.grammar ?? "";
            takes = grammar.includes("<color>") || grammar.includes("<paint>");
            this.colorProperties.set(property, takes);
        }
        return takes;
    }

    private computeDisplay(value: CssValue, resolution: Resolution): CssValue {
        // A document language can define display types for its elements, which other elements compute otherwise.
        let computed: CssValue = this.languageValue("display", value, resolution, this.elementUnits(resolution, "other")) ?? value;
        let display: DisplayType = this.displays.parse(computed);
        if (this.language === undefined && display.inner === "math") {
            // MathML Core §4.1: "if the specified value of display is block math or inline math then the computed value is block
            // flow and inline flow respectively", for elements that no language gives that display.
            display = { ...display, inner: "flow" };
            computed = this.displays.value(display);
        }
        if (this.isRoot(resolution.input)) {
            return this.displays.value(this.displays.blockifyRoot(display));
        }
        // CSS 2.1 §9.7 and CSS Display 3 §2.7 and §2.8: absolute positioning, floating, the root element, and a flex or grid
        // parent blockify the display type.
        const float: CssValue | undefined = this.standard("float", resolution);
        const position: CssValue | undefined = this.standard("position", resolution);
        const floats: boolean = float !== undefined && !(float.kind === "ident" && float.lower === "none");
        const absolute: boolean = position !== undefined && position.kind === "ident" && (position.lower === "absolute" || position.lower === "fixed");
        if (floats || absolute || this.blockifiesChildren(resolution.input)) {
            return this.displays.value(this.displays.blockify(display));
        }
        // CSS Ruby 1 §2.2: "Any in-flow boxes directly contained by" a ruby box "are inlinified"; GCPM 3 §1.2.1 takes a
        // running element out of the flow.
        const running: boolean = position !== undefined && position.kind === "function" && position.name === "running";
        if (!running && this.inlinifiesChildren(resolution.input)) {
            display = this.displays.inlinify(display);
            computed = this.displays.value(display);
        }
        // CSS Writing Modes 4 §3.2: when the writing-mode differs from that of the parent box, "if its specified inner
        // display type is flow, then its computed inner display type becomes flow-root", so an inline is an inline-block.
        if (display.box === undefined && display.internal === undefined && display.inner === "flow" && this.changesWritingMode(resolution)) {
            return this.displays.value({ ...display, inner: "flow-root" });
        }
        return computed;
    }

    private changesWritingMode(resolution: Resolution): boolean {
        // writing-mode is inherited, so only an element that sets it can differ from its parent.
        if (!resolution.toCompute.has("writing-mode")) {
            return false;
        }
        for (const ancestor of resolution.input.containers()) {
            if (this.displays.parse(ancestor.style.values["display"]).box !== "contents") {
                return JSON.stringify(this.standard("writing-mode", resolution)) !== JSON.stringify(ancestor.style.values["writing-mode"]);
            }
        }
        return false;
    }

    private computeUnicodeBidi(value: CssValue, resolution: Resolution): CssValue {
        // CSS Ruby 1 §3.5: on the ruby container and the internal ruby boxes "the normal and embed values of unicode-bidi
        // compute to isolate, and bidi-override computes to isolate-override".
        const keyword: string | undefined = value.kind === "ident" ? value.lower : undefined;
        if ((keyword !== "normal" && keyword !== "embed" && keyword !== "bidi-override") || !this.displays.isRubyBox(this.displays.parse(this.standard("display", resolution)))) {
            return value;
        }
        const computed: string = keyword === "bidi-override" ? "isolate-override" : "isolate";
        return { kind: "ident", name: computed, lower: computed };
    }

    private languageValue(property: string, value: CssValue, resolution: Resolution, units: ElementUnits): CssValue | undefined {
        // The values that a document language defines for the properties of its own specification.
        const language: LanguageValue | undefined = this.language;
        return language !== undefined && this.languageProperties?.has(property) === true ? language(property, value, resolution.input, (name: string) => this.standard(name, resolution), units,
            (): number => (this.metrics.fontSize(resolution.input.parent?.values ?? this.initialOrEmpty().values) || MEDIUM) * this.zoomOf(resolution).own) : undefined;
    }

    private inlinifiesChildren(input: StyleInput): boolean {
        // CSS Display 3 §2.7: an inlinified inline box "recursively inlinifies all of its in-flow children", and an element
        // with display: contents has no box between its parent and its children; §5: a flow run-in "inlinifies its contents".
        for (const ancestor of input.containers()) {
            const display: DisplayType = this.displays.parse(ancestor.style.values["display"]);
            if (this.displays.isRubyBox(display) || (display.box === undefined && display.internal === undefined && display.outer === "run-in" && display.inner === "flow")) {
                return true;
            }
            if (display.box !== "contents" && !this.displays.isInlineBox(display)) {
                return false;
            }
        }
        return false;
    }

    private forcedWritingMode(resolution: Resolution, value?: CssValue): CssValue | undefined {
        // CSS Ruby 1 §4.1: inter-character "forces the computed value of writing-mode of the ruby annotation children of this
        // ruby annotation container to be vertical-rl", unless "the writing mode of the enclosing ruby container is vertical".
        const input: StyleInput = resolution.input;
        if (!this.isInterCharacter(input.parent) || this.displays.parse(this.standard("display", resolution)).internal !== "ruby-text") {
            return value;
        }
        for (const ancestor of input.containers()) {
            if (this.displays.parse(ancestor.style.values["display"]).internal !== "ruby-text-container") {
                return this.isHorizontal(ancestor.style.values) ? { kind: "ident", name: "vertical-rl", lower: "vertical-rl" } : value;
            }
        }
        return value;
    }

    private isInterCharacter(style?: ComputedStyle): boolean {
        const position: CssValue | undefined = style?.values["ruby-position"];
        return position !== undefined && position.kind === "ident" && position.lower === "inter-character";
    }

    private computeFloat(value: CssValue, resolution: Resolution): CssValue {
        // CSS 2.1 §9.7: an absolutely positioned box does not float.
        const position: CssValue | undefined = this.standard("position", resolution);
        if (position !== undefined && position.kind === "ident" && (position.lower === "absolute" || position.lower === "fixed")) {
            return { kind: "ident", name: "none", lower: "none" };
        }
        return value;
    }

    private computeFontSize(value: CssValue, units: ElementUnits, resolution: Resolution): CssValue | undefined {
        // CSS Fonts 4 §2.5: keywords scale from medium, larger and smaller from the parent's size; percentages refer to the parent.
        // The parent's size carries the parent's zoom, and the element adds its own.
        const zoom: Zoom = this.zoomOf(resolution);
        const parentSize: number = (this.metrics.fontSize(resolution.input.parent?.values ?? this.initialOrEmpty().values) || MEDIUM) * zoom.own;
        let size: number | undefined;
        if (value.kind === "ident") {
            if (SIZE_FACTORS.has(value.lower)) {
                size = MEDIUM * (SIZE_FACTORS.get(value.lower) as number) * zoom.effective;
            } else if (value.lower === "larger") {
                size = parentSize * RELATIVE_SIZE_RATIO;
            } else if (value.lower === "smaller") {
                size = parentSize / RELATIVE_SIZE_RATIO;
            } else if (value.lower === "math") {
                const parent: Readonly<Record<string, CssValue>> = resolution.input.parent?.values ?? this.initialOrEmpty().values;
                size = parentSize * this.metrics.mathScale(parent, this.depthOf(parent["math-depth"]), this.depthOf(this.standard("math-depth", resolution)));
            }
        } else {
            size = this.lengths.pixelsOf(value, units, parentSize);
        }
        return size === undefined ? undefined : { kind: "length", px: Math.max(0, size) };
    }

    private computeMathDepth(value: CssValue, units: ElementUnits, input: StyleInput): CssValue {
        const inherited: number = this.depthOf(input.parent?.values["math-depth"]);
        let depth: number | undefined;
        if (value.kind === "ident" && value.lower === "auto-add") {
            const style: CssValue | undefined = input.parent?.values["math-style"];
            depth = style !== undefined && style.kind === "ident" && style.lower === "compact" ? inherited + 1 : inherited;
        } else if (value.kind === "function" && value.name === "add" && value.args.length === 1) {
            const added: number | undefined = this.integerOf(value.args[0], units);
            depth = added === undefined ? undefined : inherited + added;
        } else {
            depth = this.integerOf(value, units);
        }
        return { kind: "number", value: depth ?? inherited, integer: true };
    }

    private integerOf(value: CssValue, units: ElementUnits): number | undefined {
        // CSS Values 4 §10.9: a calculation that resolves to an <integer> is rounded to the nearest integer.
        const number: number | undefined = value.kind === "number" ? value.value : (value.kind === "calc" ? this.lengths.computeNumber(value, units) : undefined);
        return number === undefined ? undefined : Math.round(number);
    }

    private depthOf(value?: CssValue): number {
        return value !== undefined && value.kind === "number" ? value.value : 0;
    }

    private computeFontWeight(value: CssValue, input: StyleInput): CssValue | undefined {
        // CSS Fonts 4 §2.2 and §2.2.1: normal is 400, bold 700, and bolder and lighter follow the inherited weight.
        if (value.kind === "number") {
            return value;
        }
        if (value.kind !== "ident") {
            return undefined;
        }
        const parent: CssValue | undefined = input.parent?.values["font-weight"];
        const inherited: number = parent !== undefined && parent.kind === "number" ? parent.value : 400;
        let weight: number | undefined;
        switch (value.lower) {
            case "normal":
                weight = 400;
                break;
            case "bold":
                weight = 700;
                break;
            case "bolder":
                weight = inherited < 350 ? 400 : (inherited < 550 ? 700 : (inherited < 900 ? 900 : inherited));
                break;
            case "lighter":
                weight = inherited < 100 ? inherited : (inherited < 550 ? 100 : (inherited < 750 ? 400 : 700));
                break;
            default:
                weight = undefined;
        }
        return weight === undefined ? undefined : { kind: "number", value: weight, integer: Number.isInteger(weight) };
    }

    private computeFontSizeAdjust(value: CssValue, resolution: Resolution): CssValue {
        // CSS Fonts 5 §3.4: the computed value is "the keyword none, or a pair of a metric keyword and a <number>"; the metric
        // defaults to ex-height.
        const items: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "space" ? value.items : [value];
        const last: CssValue = items[items.length - 1];
        const metric: CssValue = items.length > 1 ? items[0] : { kind: "ident", name: "ex-height", lower: "ex-height" };
        if (metric.kind !== "ident" || (last.kind === "ident" && last.lower !== "from-font")) {
            return NO_ADJUSTMENT;
        }
        if (last.kind === "number") {
            return { kind: "list", separator: "space", items: [metric, last] };
        }
        // from-font "Computes to the <number> corresponding to the specified metric of the first available font, if it
        // exists. Otherwise, the same as none."
        for (const font of FONT_PROPERTIES) {
            this.standard(font, resolution);
        }
        const aspect: number | undefined = this.metrics.firstAspect(resolution.working, metric.lower);
        return aspect === undefined ? NO_ADJUSTMENT : { kind: "list", separator: "space", items: [metric, { kind: "number", value: aspect, integer: false }] };
    }

    private computeFontStyle(value: CssValue): CssValue | undefined {
        // CSS Fonts 4 §2.4: the keyword, plus the angle in degrees for oblique, 14deg when none is given.
        const items: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "space" ? value.items : [value];
        if (items[0].kind !== "ident") {
            return undefined;
        }
        if (items[0].lower !== "oblique") {
            return items[0];
        }
        const angle: CssValue | undefined = items[1];
        let degrees: number = FontMatcher.DEFAULT_OBLIQUE;
        if (angle !== undefined && angle.kind === "dimension") {
            const factor: number = angle.unit === "rad" ? 180 / Math.PI : (angle.unit === "grad" ? 0.9 : (angle.unit === "turn" ? 360 : 1));
            degrees = angle.value * factor;
        }
        return { kind: "list", separator: "space", items: [items[0], { kind: "dimension", value: degrees, unit: "deg" }] };
    }

    private computeLineHeight(value: CssValue, units: ElementUnits, resolution: Resolution): CssValue | undefined {
        // CSS Inline 3 §5.2: normal, a number, or an absolute length; a percentage is relative to the element's font size.
        if (value.kind === "ident" || value.kind === "number") {
            return value;
        }
        const number: number | undefined = value.kind === "calc" ? this.lengths.computeNumber(value, units) : undefined;
        if (number !== undefined) {
            return { kind: "number", value: Math.max(0, number), integer: Number.isInteger(number) };
        }
        for (const font of FONT_PROPERTIES) {
            this.standard(font, resolution);
        }
        const px: number | undefined = this.lengths.pixelsOf(value, units, this.metrics.fontSize(resolution.working));
        return px === undefined ? undefined : { kind: "length", px: Math.max(0, px) };
    }

    private computeSize(value: CssValue, units: ElementUnits): CssValue | undefined {
        // CSS Paged Media 3 §7.1: the specified value, with lengths made absolute.
        const items: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "space" ? value.items : [value];
        const computed: Array<CssValue> = [];
        for (const item of items) {
            const result: CssValue | undefined = item.kind === "ident" ? item : this.lengths.compute(item, units);
            if (result === undefined) {
                return undefined;
            }
            computed.push(result);
        }
        return computed.length === 1 ? computed[0] : { kind: "list", separator: "space", items: computed };
    }

    private elementUnits(resolution: Resolution, phase: Phase, zoomed: boolean = true): ElementUnits {
        // CSS Values 4 §6.1.1: font-* properties use the parent's metrics, line-height the parent's lh, and the root units on the
        // root element use the initial values inside font-* and line-height, and the element's own values elsewhere.
        const input: StyleInput = resolution.input;
        const working: Record<string, CssValue> = resolution.working;
        const initial: Readonly<Record<string, CssValue>> = this.initialOrEmpty().values;
        const parent: Readonly<Record<string, CssValue>> = input.parent?.values ?? initial;
        const root: Readonly<Record<string, CssValue>> = input.root?.values ?? (phase === "other" ? working : initial);
        return new ElementUnits(this.metrics, {
            local: phase === "font" ? parent : working,
            lineHeight: phase === "other" ? working : parent,
            root,
            rootLineHeight: root,
            viewport: input.viewport,
            horizontal: (): boolean => this.isHorizontal(working),
            container: (axis: ContainerAxis): number | null => this.containerSize(resolution, axis, zoomed),
            require: (unit: string): void => this.require(unit, resolution, phase),
            zoom: (source: ZoomSource): number => zoomed ? this.zoomFactor(resolution, phase, source) : 1
        });
    }

    private zoomFactor(resolution: Resolution, phase: Phase, source: ZoomSource): number {
        // The metrics that a unit reads carry the zoom of the element they come from: the element's own already have its
        // effective zoom, the parent's lack the element's own zoom, and the root's are divided by the root's zoom.
        const zoom: Zoom = this.zoomOf(resolution);
        switch (source) {
            case "absolute":
                return zoom.effective;
            case "local":
                return phase === "font" ? zoom.own : 1;
            case "line-height":
                return phase === "other" ? 1 : zoom.own;
            default: {
                const root: ComputedStyle | undefined = resolution.input.root;
                if (root === undefined) {
                    return phase === "other" ? 1 : zoom.effective;
                }
                return zoom.effective / (root.zoom ?? 1);
            }
        }
    }

    private isHorizontal(values: Readonly<Record<string, CssValue>>): boolean {
        const mode: CssValue | undefined = values["writing-mode"];
        return mode === undefined || mode.kind !== "ident" || mode.lower === "horizontal-tb";
    }

    private acceptsAxis(container: QueryContainer, axis: ContainerAxis): boolean {
        // CSS Conditional 5 §5.1: size accepts size queries on both axes, and inline-size on the container's inline axis; a
        // container has a size only where its size containment has an effect (CSS Containment 2 §3.1).
        const keywords: Array<string> | undefined = this.containerTypes(container.style);
        if (keywords === undefined || container.size === undefined) {
            return false;
        }
        if (keywords.includes("size")) {
            return true;
        }
        const horizontal: boolean = this.isHorizontal(container.style.values);
        return keywords.includes("inline-size") && (axis === "inline" || (axis === "width" && horizontal) || (axis === "height" && !horizontal));
    }

    private containerSize(resolution: Resolution, axis: ContainerAxis, zoomed: boolean): number | null {
        // CSS Conditional 5 §7: "The query container for each axis is the nearest ancestor container that accepts container
        // size queries on that axis"; null when there is none. Its laid out size carries its own effective zoom.
        for (const container of resolution.input.containers()) {
            if (container.size === undefined || !this.acceptsAxis(container, axis)) {
                continue;
            }
            const horizontal: boolean = this.isHorizontal(container.style.values);
            const size: number = axis === "width" || (axis === "inline" && horizontal) || (axis === "block" && !horizontal) ? container.size.width : container.size.height;
            return zoomed ? size * this.zoomOf(resolution).effective / (container.style.zoom ?? 1) : size / (container.style.zoom ?? 1);
        }
        return null;
    }

    private require(unit: string, resolution: Resolution, phase: Phase): void {
        // CSS Properties and Values 1 §2.7.2: font-relative units depend on the element's font-size, lh also on its line-height,
        // and the root units on the root element's, which is this element when there is no root above it.
        this.viewportUsed = this.viewportUsed || (!FONT_UNITS.has(unit) && !ROOT_UNITS.has(unit));
        const local: boolean = phase !== "font" && FONT_UNITS.has(unit) && !(unit === "lh" && phase === "line-height");
        const root: boolean = phase === "other" && resolution.input.root === undefined && ROOT_UNITS.has(unit);
        if (local || root) {
            for (const font of FONT_PROPERTIES) {
                this.standard(font, resolution);
            }
            // CSS Fonts 5 §3.4: font-size-adjust "can affect the size of relative units that are based on font metrics".
            this.standard(FONT_SIZE_ADJUST, resolution);
        }
        if ((local && unit === "lh" && phase === "other") || (root && unit === "rlh")) {
            this.standard("line-height", resolution);
        }
        if (LOGICAL_VIEWPORT_UNITS.test(unit)) {
            this.standard("writing-mode", resolution);
        }
    }

    private initialOrEmpty(): ComputedStyle {
        return this.initialStyle ?? { values: {}, inherited: {}, custom: {} };
    }
}
