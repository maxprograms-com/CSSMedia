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

import { XMLAttribute, XMLElement } from "typesxml";

export class SourceElement extends XMLElement {

    private parent?: SourceElement;
    private language?: string;
    private base?: string;

    constructor(name: string) {
        super(name);
    }

    getBase(): string | undefined {
        return this.base;
    }

    setBase(base?: string): void {
        if (base === undefined) {
            delete this.base;
        } else {
            this.base = base;
        }
    }

    getLanguage(): string | undefined {
        return this.language;
    }

    setLanguage(language?: string): void {
        if (language === undefined) {
            delete this.language;
        } else {
            this.language = language;
        }
    }

    getParent(): SourceElement | undefined {
        return this.parent;
    }

    private setParent(parent?: SourceElement): void {
        if (parent === undefined) {
            delete this.parent;
        } else {
            this.parent = parent;
        }
    }

    override addElement(node: XMLElement): void {
        if (node instanceof SourceElement) {
            node.setParent(this);
        }
        super.addElement(node);
    }

    override getChildren(): Array<SourceElement> {
        return super.getChildren() as Array<SourceElement>;
    }

    getLocalName(): string {
        const name: string = super.getName();
        if (name.indexOf(':') === -1) {
            return name;
        }
        const colon: number = name.indexOf(":");
        return name.substring(colon + 1);
    }

    getAttributeValue(name: string): string | undefined {
        const attribute: XMLAttribute | undefined = this.getAttribute(name);
        return attribute === undefined ? undefined : attribute.getValue();
    }
}
