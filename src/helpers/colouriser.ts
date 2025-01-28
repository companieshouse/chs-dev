import { cyan, gray, green, red, yellow } from "ansis";

type ColourMap = [RegExp, (str: string) => string][];

const statusColourMap: ColourMap = [
    [/Exited\s\([1-9]|\d{2,}\)/, red],
    [/Exited\s\(0\)/, yellow],
    [/Up[^()]+$/, green],
    [/Up.+\(health:\sstarting./, cyan],
    [/Up.+\(healthy./, green.bold],
    [/Up.+\(unhealthy/, red.bold],
    [/Not\srunning/, gray]
];

const runStatusColourMap: ColourMap = [
    [/Started/, green],
    [/Healthy/, green.bold],
    [/Stopped/, yellow]
];

const stopStatusColourMap: ColourMap = [
    [/Stopped/, yellow],
    [/Removed/, red]
];

const colourise = (colourMap: ColourMap) => (str: string) => {
    const colour = colourMap
        .find(([regex, _]) => regex.test(str));

    if (colour) {
        return colour[1](str);
    } else {
        return str;
    }
};

type SimpleColour = "cyan" | "red" | "bold-red" | "green" | "bold-green" | "yellow" | "gray" | "grey"

export const simpleColouriser = (str: string, colour: SimpleColour) => {
    let colouriseFn: (str: string) => string;

    switch (colour) {
    case "cyan":
        colouriseFn = cyan;
        break;
    case "red":
        colouriseFn = red;
        break;
    case "bold-red":
        colouriseFn = red.bold;
        break;
    case "green":
        colouriseFn = green;
        break;
    case "bold-green":
        colouriseFn = green.bold;
        break;
    case "yellow":
        colouriseFn = yellow;
        break;
    case "gray":
    case "grey":
        colouriseFn = gray;
        break;
    default:
        colouriseFn = (strToColourise: string) => strToColourise;
        break;
    }

    return colouriseFn(str);
};

export const statusColouriser = colourise(statusColourMap);
export const runStatusColouriser = colourise(runStatusColourMap);
export const stopStatusColouriser = colourise(stopStatusColourMap);
