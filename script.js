const config = {
    integerIs: 'i64',
    floatIs: 'f64',
    trueIsBool: false,
    useJsonValueInCaseIncludesOr: true,
};

/**
 * @typedef {object} StructFieldInfo
 * @property {string} field
 * @property {string} type
 * @property {string} description 
 */

/**
 * Parse the table.
 * @param {*} table 
 * @returns {StructFieldInfo[]}
 */
function getStructFieldInfoFromTable(table) {
    const dataArray = [];
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        // Get all cells in the current row
        const cells = row.querySelectorAll('td');
        const rowData = {
            field: cells[0].innerText,
            type: cells[1].innerText,
            description: cells[2].innerText
        };
        dataArray.push(rowData);
    });
    return dataArray;
}

/**
 * Generate code of one field.
 * @param {StructFieldInfo} fieldInfo 
 * @param {string} indent 
 * @returns {string}
 */
function genOneField(fieldInfo, indent = "    ") {
    let str = "";
    const isOptional = fieldInfo.description.startsWith('Optional.');
    str += indent + "/// " + replaceNewlines(fieldInfo.description) + "\n";
    str += indent + fieldInfo.field + ": ";
    if (isOptional) {
        str += "?";
    }
    str += replaceTypeIfNeeded(fieldInfo.type);
    if (isOptional) {
        str += " = null";
    }
    str += ",\n";
    return str;
}

/**
 * Generate many fields.
 * @param {StructFieldInfo[]} fieldInfoArray 
 * @returns {string}
 */
function genManyFields(fieldInfoArray) {
    let str = "";
    fieldInfoArray.forEach(data => {
        str += genOneField(data);
    });
    return str;
}

/**
 * @typedef {object} StructInfo
 * @property {string} typeName
 * @property {string} typeDoc
 * @property {StructFieldInfo[]} fields
 */

/**
 * Parse the elements.
 * @param {NodeList} elements 
 * @returns {StructInfo[]}
 */
function getStructInfoFromElements(elements) {
    const info = [];
    let currentStruct = null;
    let hasParagraph = false;
    let hasTable = false;

    elements.forEach(elem => {
        if (elem.tagName === 'H4') {
            // If there's an existing struct that didn't meet all criteria, discard it
            if (currentStruct && (!hasParagraph || !hasTable)) {
                console.error(`Incomplete struct found for type '${currentStruct.typeName}'. Excluding this StructInfo.`);
                info.pop();
            }
            // Reset flags and start a new struct
            hasParagraph = false;
            hasTable = false;
            currentStruct = {
                typeName: elem.innerText,
                typeDoc: '',
                fields: []
            };
            info.push(currentStruct);
        } else if (elem.tagName === 'P' && currentStruct) {
            // If the element is a p, add it to the current h4 subsection's typeDoc
            currentStruct.typeDoc += elem.innerText;
            hasParagraph = true;
        } else if (elem.classList.contains('table') && currentStruct) {
            // If the element is a table, validate and parse the table rows, then add to the current h4 subsection's fields
            if (isValidTableOfType(elem)) {
                const tableData = getStructFieldInfoFromTable(elem);
                currentStruct.fields = tableData;
                hasTable = true;
            } else {
                console.error(`Invalid table format found for type '${currentStruct.typeName}'. Excluding this StructInfo.`);
                // Remove the currentStruct from info if table format is invalid
                info.pop();
                currentStruct = null;
            }
        }
    });

    // Final check for the last struct
    if (currentStruct && (!hasParagraph || !hasTable)) {
        console.error(`Incomplete struct found for type ${currentStruct.typeName}. Excluding this StructInfo.`);
        info.pop();
    }

    return info;
}

/**
 * Validate if the given table has the correct headers.
 * 
 * This function checks if the table has exactly three headers and 
 * if those headers are "Field", "Type", and "Description" respectively.
 * 
 * @param {HTMLTableElement} table - The table element to validate.
 * @returns {boolean} - True if the table is valid, false otherwise.
 */
function isValidTableOfType(table) {
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText.trim());
    return headers.length === 3 && headers[0] === 'Field' && headers[1] === 'Type' && headers[2] === 'Description';
}

/**
 * Generate struct definition.
 * @param {StructInfo} structInfo 
 * @returns {string}
 */
function genStructDef(structInfo) {
    let str = "";
    str += "/// " + replaceNewlines(structInfo.typeDoc) + "\n";
    str += "pub const " + structInfo.typeName + " = struct {\n";
    str += genManyFields(structInfo.fields);
    str += "};";
    return str;
}

/**
 * Check if type can be replace, if it can, replace it.
 * @param {string} type - The type name.
 * @returns {string}
 */
function replaceTypeIfNeeded(type) {
    type = replaceArrayOf(type);
    if (type.startsWith('[]')) {
        return '[]' + replaceTypeIfNeeded(type.slice(2));
    }
    if (type === 'Integer') {
        if (config.integerIs === null) {
            return '@compileError("It\'s a Integer, choose one integer type")';
        } else {
            return config.integerIs;
        }
    }
    if (type === 'Float') {
        if (config.floatIs === null) {
            return '@compileError("It\'s a Float, choose one float type")';
        } else {
            return config.floatIs;
        }
    }
    if (type === 'Boolean') {
        return 'bool';
    }
    if (type === 'True') {
        if (config.trueIsBool) {
            return 'bool';
        } else {
            return '@TypeOf(true)';
        }
    }
    if (type === 'String') {
        return '[]u8';
    }
    if (type === 'Integer or String') {
        return 'integer_or_string';
    }
    if (type.includes('or')) {
        if (config.useJsonValueInCaseIncludesOr) {
            return 'std.json.Value';
        } else {
            return `@compileError("Type name includes 'or' not yet supported: '${type}'")`;
        }
    }
    return type;
}

/**
 * Filter good data, and print bad data.
 * @param {StructInfo[]} info 
 * @returns {StructInfo[]}
 */
function ignoreBad(info) {
    let bad = [];
    let good = [];
    info.forEach((datum, index) => {
        // Check if fields is an array and if it is empty,
        // or it is not TitleCase.
        if (
            (Array.isArray(datum.fields) && datum.fields.length === 0)
            || !isGoodTypeName(datum.typeName)
        ) {
            bad.push({ index, typeName: datum.typeName });
        } else {
            good.push(datum);
        }
    });
    console.log(`Ignored ${bad.length} bad data, they are ${bad.map(b => `${b.index}:${b.typeName}`)}`);
    return good;
}

/**
 * Generate all codes.
 * @param {StructInfo[]} structInfoArray 
 * @returns {string}
 */
function genCode(structInfoArray) {
    let str = "";
    structInfoArray.forEach(structuredDatum => {
        str += genStructDef(structuredDatum);
        str += "\n\n";
    });
    return str;
}

/**
 * Check is the name a good name of type. (TitleCase)
 * @param {string} str - The input string for check.
 * @returns {boolean} - Passed or not.
 */
function isGoodTypeName(str) {
    const typeNameRegex = /^[A-Z][a-z0-9]*([A-Z][a-z0-9]*)*$/;
    return typeNameRegex.test(str);
}

/**
 * Replace newlines in a string with '\n' + ident + '/// '
 * @param {string} input - The input string with newlines.
 * @returns {string} - The modified string with replaced newlines.
 */
function replaceNewlines(input, ident = "") {
    return input.replace(/\n/g, '\n' + ident + '/// ');
}

/**
 * Replace "Array of X" with "[]X" in a string
 * @param {string} input - The input string containing "Array of X".
 * @returns {string} - The modified string with replaced instances.
 */
function replaceArrayOf(input) {
    return input.replace(/Array of\s+(\w+)/g, '[]$1');
}

const devPageContent = document.querySelector('#dev_page_content');

/**
 * Get elements in the range between "Available types" and "Available methods".
 * 
 * This function creates a range between the H3 elements with text content "Available types"
 * and "Available methods", then retrieves all child elements within that range that match 
 * the selectors 'h4', 'p', and '.table'.
 * 
 * @returns {Element[]} - An array of elements within the specified range.
 */
function getElementsInRangeAvailableTypes() {
    const range = document.createRange();
    const startTitle = Array.from(devPageContent.querySelectorAll('h3')).find(h3 => 
        h3.textContent === 'Available types'
    );
    const endTitle = Array.from(devPageContent.querySelectorAll('h3')).find(h3 => 
        h3.textContent === 'Available methods'
    );
    if (!startTitle || !endTitle) return [];

    range.setStartAfter(startTitle);
    range.setEndBefore(endTitle);
    
    const elements = Array.from(range.cloneContents().children)
        .filter(el => el.matches('h4, p, .table'));

    return elements;
}

const availableTypes = getStructInfoFromElements(getElementsInRangeAvailableTypes());
console.log(availableTypes);
console.log(`Generate ${availableTypes.length} types, they are ${availableTypes.map(e => e.typeName)}`);
console.log(genCode(availableTypes));
