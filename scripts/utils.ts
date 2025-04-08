// ANSI color codes for console output
export const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
};

// Helper function to print step headers
export function printStep(step: string) {
    console.log(`\n${colors.bright}${colors.cyan}=== ${step} ===${colors.reset}\n`);
}

// Helper function to format a success message
export function printSuccess(message: string) {
    console.log(`${colors.green}${message}${colors.reset}`);
}

// Helper function to format an error message
export function printError(message: string) {
    console.log(`${colors.red}${message}${colors.reset}`);
}

// Helper function to format a warning message
export function printWarning(message: string) {
    console.log(`${colors.yellow}${message}${colors.reset}`);
}

// Helper function to format an info message
export function printInfo(message: string) {
    console.log(`${colors.blue}${message}${colors.reset}`);
}

// Helper function to format a dimmed message (for background processes)
export function printDim(message: string) {
    console.log(`${colors.dim}${message}${colors.reset}`);
} 