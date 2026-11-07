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

import type { CssValue } from "../css/values/CssValue.js";

export interface Counter {
    name: string;
    creator: number;
    value: number;
    shadow?: boolean;
}

export type CounterSet = ReadonlyArray<Counter>;

export type CounterChange = readonly [string, number];

export class CounterScopes {

    private readonly parents: Array<number> = [];

    node(parent?: number): number {
        this.parents.push(parent ?? -1);
        return this.parents.length - 1;
    }

    inherit(node: number, parent?: CounterSet, sibling?: CounterSet, previous?: CounterSet): Array<Counter> {
        // CSS Lists 3 §4.4.1: the parent's counters, then those of the preceding sibling whose names are not there yet, with the
        // values of the element that precedes it in tree order.
        const counters: Array<Counter> = [];
        if (parent !== undefined) {
            for (const counter of parent) {
                counters.push({ ...counter });
            }
        }
        if (sibling !== undefined) {
            for (const counter of sibling) {
                if (!counters.some((known: Counter) => known.name === counter.name)) {
                    counters.push({ ...counter });
                }
            }
        }
        if (previous !== undefined) {
            for (const source of previous) {
                // A shadow has the scoping element as creator, as a counter that element reset for itself does, and they stay apart.
                const target: Counter | undefined = counters.find((counter: Counter) => counter.name === source.name && counter.creator === source.creator && counter.shadow === source.shadow);
                if (target !== undefined) {
                    target.value = source.value;
                } else if (source.shadow === true && this.isWithin(node, source.creator)) {
                    // CSS Containment 2 §3.3: a counter set "at the scoping element" reaches all of its subtree, wherever its first use was.
                    counters.push({ ...source });
                }
            }
        }
        return counters;
    }

    apply(counters: Array<Counter>, node: number, resets?: ReadonlyArray<CounterChange>, increments?: ReadonlyArray<CounterChange>, sets?: ReadonlyArray<CounterChange>,
        scope?: number): void {
        // CSS Lists 3 §4: counters are instantiated, then incremented, then set.
        if (resets !== undefined) {
            for (const [name, value] of resets) {
                this.instantiate(counters, node, name, value);
            }
        }
        if (increments !== undefined) {
            for (const [name, value] of increments) {
                this.scoped(counters, node, name, scope).value += value;
            }
        }
        if (sets !== undefined) {
            for (const [name, value] of sets) {
                this.scoped(counters, node, name, scope).value = value;
            }
        }
    }

    private scoped(counters: Array<Counter>, node: number, name: string, scope?: number): Counter {
        // CSS Containment 2 §3.3: inside an element with style containment, "the first use of it within the subtree acts as if
        // the named counter were set to 0 at the scoping element", and the counters outside are not changed.
        if (scope === undefined) {
            return this.innermost(counters, node, name);
        }
        const counter: Counter | undefined = this.latest(counters, name);
        if (counter !== undefined && (this.isWithin(counter.creator, scope) || (counter.shadow === true && counter.creator === scope))) {
            return counter;
        }
        const shadow: Counter = { name, creator: scope, value: 0, shadow: true };
        counters.push(shadow);
        return shadow;
    }

    private isWithin(node: number, scope: number): boolean {
        for (let ancestor: number = this.parents[node]; ancestor !== undefined && ancestor >= 0; ancestor = this.parents[ancestor]) {
            if (ancestor === scope) {
                return true;
            }
        }
        return false;
    }

    values(counters: Array<Counter>, node: number, name: string): Array<number> {
        // CSS Lists 3 §4.7: a counter that does not exist is first instantiated with the value 0.
        this.innermost(counters, node, name);
        return counters.filter((counter: Counter) => counter.name === name).map((counter: Counter) => counter.value);
    }

    changes(defaultValue: number, value?: CssValue): Array<CounterChange> | undefined {
        // CSS Lists 3 §4.1 and §4.2: [ <counter-name> <integer>? ]+ or none.
        if (value === undefined) {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "space" ? value.items : [value];
        let changes: Array<CounterChange> | undefined;
        for (let index: number = 0; index < items.length; index++) {
            const item: CssValue = items[index];
            if (item.kind !== "ident" || item.lower === "none") {
                continue;
            }
            const next: CssValue | undefined = items[index + 1];
            changes = changes ?? [];
            if (next !== undefined && next.kind === "number") {
                changes.push([item.name, next.value]);
                index++;
            } else {
                changes.push([item.name, defaultValue]);
            }
        }
        return changes;
    }

    private innermost(counters: Array<Counter>, node: number, name: string): Counter {
        return this.latest(counters, name) ?? this.instantiate(counters, node, name, 0);
    }

    private latest(counters: ReadonlyArray<Counter>, name: string): Counter | undefined {
        for (let index: number = counters.length - 1; index >= 0; index--) {
            if (counters[index].name === name) {
                return counters[index];
            }
        }
        return undefined;
    }

    private instantiate(counters: Array<Counter>, node: number, name: string, value: number): Counter {
        // CSS Lists 3 §4.4.2: a counter created by the node itself or by a previous sibling gives way to the new one.
        for (let index: number = counters.length - 1; index >= 0; index--) {
            if (counters[index].name === name) {
                const creator: number = counters[index].creator;
                if (creator === node || this.parents[creator] === this.parents[node]) {
                    counters.splice(index, 1);
                }
                break;
            }
        }
        const counter: Counter = { name, creator: node, value };
        counters.push(counter);
        return counter;
    }
}
