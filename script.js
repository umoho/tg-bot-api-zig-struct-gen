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
    elements.forEach(elem => {
        if (elem.tagName === 'H3') {
            // If the element is an h3, create a new section
            info.push({
                typeName: elem.innerText,
                typeDoc: [],
                fields: []
            });
        } else if (elem.tagName === 'H4') {
            // If the element is an h4, create a new subsection within the last h3 section
            info.push({
                typeName: elem.innerText,
                typeDoc: '',
                fields: []
            });
        } else if (elem.tagName === 'P') {
            // If the element is a p, add it to the current h4 subsection's typeDoc
            if (info.length > 0) {
                info[info.length - 1].typeDoc += elem.innerText + ' ';
            }
        } else if (elem.classList.contains('table')) {
            // If the element is a table, parse the table rows and add to the current h4 subsection's fields
            const tableData = getStructFieldInfoFromTable(elem);
            if (info.length > 0) {
                info[info.length - 1].fields = tableData;
            }
        }
    });
    return info;
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
    const typeNameRegex = /^[A-Z][a-z]*([A-Z][a-z]*)*$/;
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
const elements = devPageContent.querySelectorAll('h3, h4, p, .table');
const result = getStructInfoFromElements(elements, getStructFieldInfoFromTable);
const goodResult = ignoreBad(result);
console.log(`Generate ${goodResult.length} types, they are ${goodResult.map(e => e.typeName)}`);
console.log(genCode(goodResult));
