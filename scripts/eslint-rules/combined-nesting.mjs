/** Count enclosing control flow and nested functions together. */
export default {
    meta: {
        type: 'suggestion',
        docs: {
            description:
                'Limit combined control-flow and nested-function depth',
        },
        schema: [{ type: 'integer', minimum: 0 }],
        defaultOptions: [3],
        messages: {
            tooDeep:
                'Combined nesting depth is {{depth}}. Maximum allowed is {{max}}. Flatten the control flow or extract a named operation.',
        },
    },
    create(context) {
        const max = context.options[0] ?? 3;
        const functions = [];
        let depth = 0;
        const enter = (node) => {
            depth++;
            // Report the first excess on each path without cascading diagnostics.
            if (depth === max + 1)
                context.report({
                    node,
                    messageId: 'tooDeep',
                    data: { depth, max },
                });
        };
        const leave = () => {
            depth--;
        };
        const enterFunction = (node) => {
            const nested = functions.length > 0;
            functions.push(nested);
            if (nested) enter(node);
        };
        const leaveFunction = () => {
            if (functions.pop()) leave();
        };
        const elseIf = (node) =>
            node.parent.type === 'IfStatement' &&
            node.parent.alternate === node;
        return {
            FunctionDeclaration: enterFunction,
            FunctionExpression: enterFunction,
            ArrowFunctionExpression: enterFunction,
            StaticBlock: enterFunction,
            'FunctionDeclaration:exit': leaveFunction,
            'FunctionExpression:exit': leaveFunction,
            'ArrowFunctionExpression:exit': leaveFunction,
            'StaticBlock:exit': leaveFunction,
            IfStatement(node) {
                if (!elseIf(node)) enter(node);
            },
            'IfStatement:exit'(node) {
                if (!elseIf(node)) leave();
            },
            SwitchStatement: enter,
            TryStatement: enter,
            DoWhileStatement: enter,
            WhileStatement: enter,
            WithStatement: enter,
            ForStatement: enter,
            ForInStatement: enter,
            ForOfStatement: enter,
            'SwitchStatement:exit': leave,
            'TryStatement:exit': leave,
            'DoWhileStatement:exit': leave,
            'WhileStatement:exit': leave,
            'WithStatement:exit': leave,
            'ForStatement:exit': leave,
            'ForInStatement:exit': leave,
            'ForOfStatement:exit': leave,
        };
    },
};
