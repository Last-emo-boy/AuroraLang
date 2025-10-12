#include "aurc_native.h"

#include <ctype.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#include <direct.h>
#endif

typedef struct string_binding {
    char name[128];
    char literal[1024];
    int in_use;
} string_binding;

#define MAX_STRING_BINDINGS 8

typedef enum program_kind {
    PROGRAM_NONE = 0,
    PROGRAM_STRING = 1,
    PROGRAM_LOOP_SUM = 2,
    PROGRAM_PI_TEST = 3
} program_kind;

typedef struct loop_ir {
    char accumulator[128];
    int accumulator_init;
    char counter[128];
    int counter_init;
    char exit_var[128];
    char return_var[128];
} loop_ir;

typedef struct pi_ir {
    char numerator_var[128];
    int numerator_value;
    char denominator_var[128];
    int denominator_value;
    char scale_var[128];
    int scale_value;
    char temp_var[128];
    char temp_lhs[128];
    char temp_rhs[128];
    char result_var[128];
    char result_lhs[128];
    char result_rhs[128];
    char exit_var[128];
    char return_var[128];
} pi_ir;

typedef struct program_ir {
    program_kind kind;
    string_binding bindings[MAX_STRING_BINDINGS];
    int string_binding_count;
    int print_binding_index;
    char print_arg[128];
    int have_print;
    int exit_value;
    int return_value;
    int have_exit;
    int have_return;
    loop_ir loop;
    pi_ir pi;
} program_ir;

typedef enum isa_opcode {
    ISA_OPCODE_NOP = 0x00,
    ISA_OPCODE_MOV = 0x01,
    ISA_OPCODE_ADD = 0x04,
    ISA_OPCODE_SUB = 0x05,
    ISA_OPCODE_CMP = 0x06,
    ISA_OPCODE_JMP = 0x07,
    ISA_OPCODE_CJMP = 0x08,
    ISA_OPCODE_CALL = 0x09,
    ISA_OPCODE_RET = 0x0A,
    ISA_OPCODE_SVC = 0x0B,
    ISA_OPCODE_HALT = 0x0C,
    ISA_OPCODE_MUL = 0x0D,
    ISA_OPCODE_DIV = 0x0E,
    ISA_OPCODE_REM = 0x0F
} isa_opcode;

typedef enum isa_register {
    ISA_REG_R0 = 0,
    ISA_REG_R1 = 1,
    ISA_REG_R2 = 2,
    ISA_REG_R3 = 3,
    ISA_REG_R4 = 4,
    ISA_REG_R5 = 5,
    ISA_REG_R6 = 6,
    ISA_REG_R7 = 7
} isa_register;

typedef enum isa_condition {
    ISA_COND_EQ = 0x01,
    ISA_COND_NE = 0x02,
    ISA_COND_LT = 0x03,
    ISA_COND_LE = 0x04,
    ISA_COND_GT = 0x05,
    ISA_COND_GE = 0x06
} isa_condition;

enum {
    ISA_OPERAND_UNUSED = 0x00,
    ISA_OPERAND_LABEL = 0xFE,
    ISA_OPERAND_IMMEDIATE = 0xFF
};

static uint64_t pack_instruction_word(uint8_t opcode, uint8_t op0, uint8_t op1, uint8_t op2, uint32_t imm32) {
    uint64_t word = 0;
    word |= (uint64_t)opcode << 56;
    word |= (uint64_t)op0 << 48;
    word |= (uint64_t)op1 << 40;
    word |= (uint64_t)op2 << 32;
    word |= (uint64_t)imm32;
    return word;
}

static void emit_instruction_word(FILE *out, uint64_t word, const char *comment) {
    if (comment == NULL) {
        comment = "";
    }
    fprintf(out, "bytes 0x%016llX  ; %s\n", (unsigned long long)word, comment);
}

static int ensure_signed_32_range(long long value, const char *what) {
    if (value < INT32_MIN || value > INT32_MAX) {
        fprintf(stderr, "aurc-native: %s immediate %lld exceeds 32-bit range\n", what, value);
        return 1;
    }
    return 0;
}

static uint64_t encode_mov_immediate(isa_register dest, int32_t value) {
    return pack_instruction_word((uint8_t)ISA_OPCODE_MOV, (uint8_t)dest, ISA_OPERAND_IMMEDIATE, ISA_OPERAND_UNUSED, (uint32_t)value);
}

static uint64_t encode_mov_register(isa_register dest, isa_register source) {
    return pack_instruction_word((uint8_t)ISA_OPCODE_MOV, (uint8_t)dest, (uint8_t)source, ISA_OPERAND_UNUSED, 0);
}

static uint64_t encode_mov_label(isa_register dest) {
    return pack_instruction_word((uint8_t)ISA_OPCODE_MOV, (uint8_t)dest, ISA_OPERAND_LABEL, ISA_OPERAND_UNUSED, 0);
}

static uint64_t encode_arith_reg_reg(isa_opcode opcode, isa_register dest, isa_register lhs, isa_register rhs) {
    return pack_instruction_word((uint8_t)opcode, (uint8_t)dest, (uint8_t)lhs, (uint8_t)rhs, 0);
}

#define encode_mul_reg_reg(dest, lhs, rhs) encode_arith_reg_reg(ISA_OPCODE_MUL, dest, lhs, rhs)
#define encode_div_reg_reg(dest, lhs, rhs) encode_arith_reg_reg(ISA_OPCODE_DIV, dest, lhs, rhs)
#define encode_rem_reg_reg(dest, lhs, rhs) encode_arith_reg_reg(ISA_OPCODE_REM, dest, lhs, rhs)

static uint64_t encode_arith_reg_imm(isa_opcode opcode, isa_register dest, isa_register lhs, int32_t imm) {
    return pack_instruction_word((uint8_t)opcode, (uint8_t)dest, (uint8_t)lhs, ISA_OPERAND_IMMEDIATE, (uint32_t)imm);
}

static uint64_t encode_cmp_reg_imm(isa_register lhs, int32_t imm) {
    return pack_instruction_word((uint8_t)ISA_OPCODE_CMP, (uint8_t)lhs, ISA_OPERAND_IMMEDIATE, ISA_OPERAND_UNUSED, (uint32_t)imm);
}

static uint64_t encode_cjmp(isa_condition cond) {
    return pack_instruction_word((uint8_t)ISA_OPCODE_CJMP, (uint8_t)cond, ISA_OPERAND_LABEL, ISA_OPERAND_UNUSED, 0);
}

static uint64_t encode_jmp(void) {
    return pack_instruction_word((uint8_t)ISA_OPCODE_JMP, ISA_OPERAND_LABEL, ISA_OPERAND_UNUSED, ISA_OPERAND_UNUSED, 0);
}

static int find_string_binding_index(const program_ir *ir, const char *name) {
    for (int i = 0; i < ir->string_binding_count; ++i) {
        if (strcmp(ir->bindings[i].name, name) == 0) {
            return i;
        }
    }
    return -1;
}

static int add_string_binding(program_ir *ir, const char *name, const char *literal) {
    if (find_string_binding_index(ir, name) >= 0) {
        fprintf(stderr, "aurc-native: duplicate string binding for %s\n", name);
        return -1;
    }
    if (ir->string_binding_count >= MAX_STRING_BINDINGS) {
        fprintf(stderr, "aurc-native: too many string bindings for MVP compiler\n");
        return -1;
    }
    string_binding *binding = &ir->bindings[ir->string_binding_count];
    strncpy(binding->name, name, sizeof binding->name - 1);
    binding->name[sizeof binding->name - 1] = '\0';
    strncpy(binding->literal, literal, sizeof binding->literal - 1);
    binding->literal[sizeof binding->literal - 1] = '\0';
    binding->in_use = 1;
    ir->string_binding_count++;
    return ir->string_binding_count - 1;
}

static char *trim(char *line) {
    if (line == NULL) {
        return NULL;
    }
    while (*line && isspace((unsigned char)*line)) {
        ++line;
    }
    size_t len = strlen(line);
    while (len > 0 && isspace((unsigned char)line[len - 1])) {
        line[--len] = '\0';
    }
    return line;
}

static int parse_string_program(char lines[][2048], int line_count, program_ir *ir) {
    for (int i = 0; i < line_count; ++i) {
        const char *line = lines[i];

        if (strncmp(line, "let ", 4) == 0) {
            char name[128];
            char literal[1024];
            int matched = sscanf(line, "let %127[^:]: string = \"%1023[^\"]\";", name, literal);
            if (matched == 2) {
                char *trimmed_name = trim(name);
                if (add_string_binding(ir, trimmed_name, literal) < 0) {
                    return 1;
                }
                continue;
            }
        }

        if (strncmp(line, "request service print", sizeof("request service print") - 1) == 0) {
            const char *open = strchr(line, '(');
            const char *close = strrchr(line, ')');
            if (open && close && close > open + 1) {
                size_t len = (size_t)(close - open - 1);
                if (len >= sizeof ir->print_arg) {
                    len = sizeof ir->print_arg - 1;
                }
                strncpy(ir->print_arg, open + 1, len);
                ir->print_arg[len] = '\0';
                char *trimmed = trim(ir->print_arg);
                memmove(ir->print_arg, trimmed, strlen(trimmed) + 1);
                ir->have_print = 1;
                int idx = find_string_binding_index(ir, ir->print_arg);
                if (idx >= 0) {
                    ir->print_binding_index = idx;
                }
                continue;
            }
        }

        if (strncmp(line, "request service exit", sizeof("request service exit") - 1) == 0) {
            int value;
            if (sscanf(line, "request service exit(%d);", &value) == 1) {
                ir->exit_value = value;
                ir->have_exit = 1;
                continue;
            }
        }

        if (strncmp(line, "return", 6) == 0) {
            int value;
            if (sscanf(line, "return %d;", &value) == 1) {
                ir->return_value = value;
                ir->have_return = 1;
                continue;
            }
        }
    }

    ir->kind = PROGRAM_STRING;
    return 0;
}

typedef struct int_binding {
    char name[128];
    int value;
} int_binding;

static int_binding *find_binding(int_binding *bindings, int count, const char *name) {
    for (int i = 0; i < count; ++i) {
        if (strcmp(bindings[i].name, name) == 0) {
            return &bindings[i];
        }
    }
    return NULL;
}

static int parse_loop_sum_program(char lines[][2048], int line_count, program_ir *ir) {
    int_binding bindings[8];
    int binding_count = 0;
    int loop_start = -1;
    char loop_var[128] = {0};

    for (int i = 0; i < line_count; ++i) {
        const char *line = lines[i];

        if (strncmp(line, "let ", 4) == 0 && strstr(line, ": int =") != NULL) {
            char name[128];
            int value;
            if (sscanf(line, "let %127[^:]: int = %d;", name, &value) == 2) {
                if (find_binding(bindings, binding_count, name) != NULL) {
                    fprintf(stderr, "aurc-native: duplicate int binding for %s\n", name);
                    return 1;
                }
                if (binding_count >= (int)(sizeof bindings / sizeof bindings[0])) {
                    fprintf(stderr, "aurc-native: too many int bindings for loop lowering\n");
                    return 1;
                }
                strncpy(bindings[binding_count].name, name, sizeof bindings[binding_count].name - 1);
                bindings[binding_count].name[sizeof bindings[binding_count].name - 1] = '\0';
                bindings[binding_count].value = value;
                ++binding_count;
                continue;
            }
        }

        if (strncmp(line, "while", 5) == 0) {
            char var[128];
            if (sscanf(line, "while %127[^>]> 0 {", var) == 1) {
                strncpy(loop_var, trim(var), sizeof loop_var - 1);
                loop_var[sizeof loop_var - 1] = '\0';
                loop_start = i;
            }
            continue;
        }

    if (strncmp(line, "request service exit", sizeof("request service exit") - 1) == 0) {
            if (sscanf(line, "request service exit(%127[^)]);", ir->loop.exit_var) != 1) {
                fprintf(stderr, "aurc-native: malformed exit statement\n");
                return 1;
            }
            char *trimmed = trim(ir->loop.exit_var);
            memmove(ir->loop.exit_var, trimmed, strlen(trimmed) + 1);
            continue;
        }

        if (strncmp(line, "return", 6) == 0) {
            if (sscanf(line, "return %127[^;];", ir->loop.return_var) != 1) {
                fprintf(stderr, "aurc-native: malformed return statement\n");
                return 1;
            }
            char *trimmed = trim(ir->loop.return_var);
            memmove(ir->loop.return_var, trimmed, strlen(trimmed) + 1);
            continue;
        }
    }

    if (loop_start < 0) {
        fprintf(stderr, "aurc-native: expected while-loop in arithmetic example\n");
        return 1;
    }

    if (loop_start + 3 >= line_count) {
        fprintf(stderr, "aurc-native: loop body too short for lowering\n");
        return 1;
    }

    const char *add_line = lines[loop_start + 1];
    const char *sub_line = lines[loop_start + 2];

    char add_target[128], add_lhs[128], add_rhs[128];
    if (sscanf(add_line, "%127[^=]= %127[^+]+ %127[^;];", add_target, add_lhs, add_rhs) != 3) {
        fprintf(stderr, "aurc-native: expected accumulator assignment in loop body\n");
        return 1;
    }
    char sub_target[128], sub_lhs[128], sub_rhs[128];
    if (sscanf(sub_line, "%127[^=]= %127[^-]- %127[^;];", sub_target, sub_lhs, sub_rhs) != 3) {
        fprintf(stderr, "aurc-native: expected counter decrement in loop body\n");
        return 1;
    }

    char *trim_add_target = trim(add_target);
    char *trim_add_lhs = trim(add_lhs);
    char *trim_add_rhs = trim(add_rhs);
    char *trim_sub_target = trim(sub_target);
    char *trim_sub_lhs = trim(sub_lhs);
    char *trim_sub_rhs = trim(sub_rhs);

    if (strcmp(trim_add_target, trim_add_lhs) != 0) {
        fprintf(stderr, "aurc-native: accumulator update must add into same variable\n");
        return 1;
    }

    if (strcmp(trim_add_rhs, loop_var) != 0) {
        fprintf(stderr, "aurc-native: accumulator must add loop counter\n");
        return 1;
    }

    if (strcmp(trim_sub_target, loop_var) != 0 || strcmp(trim_sub_lhs, loop_var) != 0) {
        fprintf(stderr, "aurc-native: counter decrement must target loop counter\n");
        return 1;
    }

    if (strcmp(trim_sub_rhs, "1") != 0) {
        fprintf(stderr, "aurc-native: counter decrement must subtract 1\n");
        return 1;
    }

    int_binding *acc_binding = find_binding(bindings, binding_count, trim_add_target);
    int_binding *counter_binding = find_binding(bindings, binding_count, loop_var);

    if (!acc_binding || !counter_binding) {
        fprintf(stderr, "aurc-native: accumulator/counter must be defined via let\n");
        return 1;
    }

    strncpy(ir->loop.accumulator, trim_add_target, sizeof ir->loop.accumulator - 1);
    ir->loop.accumulator[sizeof ir->loop.accumulator - 1] = '\0';
    ir->loop.accumulator_init = acc_binding->value;
    strncpy(ir->loop.counter, loop_var, sizeof ir->loop.counter - 1);
    ir->loop.counter[sizeof ir->loop.counter - 1] = '\0';
    ir->loop.counter_init = counter_binding->value;

    ir->kind = PROGRAM_LOOP_SUM;
    return 0;
}

static int parse_pi_program(char lines[][2048], int line_count, program_ir *ir) {
    int_binding bindings[8];
    int binding_count = 0;
    int have_mul = 0;
    int have_div = 0;

    memset(&ir->pi, 0, sizeof ir->pi);

    for (int i = 0; i < line_count; ++i) {
        const char *line = lines[i];

        if (strncmp(line, "let ", 4) == 0) {
            char name_buf[128];
            char expr_buf[256];
            if (sscanf(line, "let %127[^:]: int = %255[^;];", name_buf, expr_buf) == 2) {
                char *name = trim(name_buf);
                char *expr = trim(expr_buf);
                if (strchr(expr, '*')) {
                    if (have_mul) {
                        fprintf(stderr, "aurc-native: multiple multiplication statements detected in pi program\n");
                        return 1;
                    }
                    char lhs_buf[128];
                    char rhs_buf[128];
                    if (sscanf(expr, "%127[^*]*%127[^;]", lhs_buf, rhs_buf) != 2) {
                        fprintf(stderr, "aurc-native: malformed multiplication expression in pi program\n");
                        return 1;
                    }
                    char *lhs = trim(lhs_buf);
                    char *rhs = trim(rhs_buf);
                    strncpy(ir->pi.temp_var, name, sizeof ir->pi.temp_var - 1);
                    ir->pi.temp_var[sizeof ir->pi.temp_var - 1] = '\0';
                    strncpy(ir->pi.temp_lhs, lhs, sizeof ir->pi.temp_lhs - 1);
                    ir->pi.temp_lhs[sizeof ir->pi.temp_lhs - 1] = '\0';
                    strncpy(ir->pi.temp_rhs, rhs, sizeof ir->pi.temp_rhs - 1);
                    ir->pi.temp_rhs[sizeof ir->pi.temp_rhs - 1] = '\0';
                    have_mul = 1;
                    continue;
                }
                if (strchr(expr, '/')) {
                    if (have_div) {
                        fprintf(stderr, "aurc-native: multiple division statements detected in pi program\n");
                        return 1;
                    }
                    char lhs_buf[128];
                    char rhs_buf[128];
                    if (sscanf(expr, "%127[^/]/%127[^;]", lhs_buf, rhs_buf) != 2) {
                        fprintf(stderr, "aurc-native: malformed division expression in pi program\n");
                        return 1;
                    }
                    char *lhs = trim(lhs_buf);
                    char *rhs = trim(rhs_buf);
                    strncpy(ir->pi.result_var, name, sizeof ir->pi.result_var - 1);
                    ir->pi.result_var[sizeof ir->pi.result_var - 1] = '\0';
                    strncpy(ir->pi.result_lhs, lhs, sizeof ir->pi.result_lhs - 1);
                    ir->pi.result_lhs[sizeof ir->pi.result_lhs - 1] = '\0';
                    strncpy(ir->pi.result_rhs, rhs, sizeof ir->pi.result_rhs - 1);
                    ir->pi.result_rhs[sizeof ir->pi.result_rhs - 1] = '\0';
                    have_div = 1;
                    continue;
                }

                char *endptr = NULL;
                long long value = strtoll(expr, &endptr, 10);
                if (endptr == expr || *endptr != '\0') {
                    fprintf(stderr, "aurc-native: unsupported initializer in pi program for %s\n", name);
                    return 1;
                }
                if (binding_count >= (int)(sizeof bindings / sizeof bindings[0])) {
                    fprintf(stderr, "aurc-native: too many integer bindings in pi program\n");
                    return 1;
                }
                strncpy(bindings[binding_count].name, name, sizeof bindings[binding_count].name - 1);
                bindings[binding_count].name[sizeof bindings[binding_count].name - 1] = '\0';
                bindings[binding_count].value = (int)value;
                ++binding_count;
                continue;
            }
        }

        if (strncmp(line, "request service exit", sizeof "request service exit" - 1) == 0) {
            if (sscanf(line, "request service exit(%127[^)]);", ir->pi.exit_var) != 1) {
                fprintf(stderr, "aurc-native: malformed exit statement in pi program\n");
                return 1;
            }
            char *trimmed = trim(ir->pi.exit_var);
            memmove(ir->pi.exit_var, trimmed, strlen(trimmed) + 1);
            continue;
        }

        if (strncmp(line, "return", 6) == 0) {
            if (sscanf(line, "return %127[^;];", ir->pi.return_var) != 1) {
                fprintf(stderr, "aurc-native: malformed return statement in pi program\n");
                return 1;
            }
            char *trimmed = trim(ir->pi.return_var);
            memmove(ir->pi.return_var, trimmed, strlen(trimmed) + 1);
            continue;
        }
    }

    if (!have_mul || !have_div) {
        fprintf(stderr, "aurc-native: pi program requires multiplication and division statements\n");
        return 1;
    }

    if (ir->pi.exit_var[0] == '\0' || ir->pi.return_var[0] == '\0') {
        fprintf(stderr, "aurc-native: pi program must include exit and return statements\n");
        return 1;
    }

    if (strcmp(ir->pi.exit_var, ir->pi.return_var) != 0) {
        fprintf(stderr, "aurc-native: pi program exit and return targets must match\n");
        return 1;
    }

    if (strcmp(ir->pi.result_var, ir->pi.exit_var) != 0) {
        fprintf(stderr, "aurc-native: exit must target the pi result variable\n");
        return 1;
    }

    if (strcmp(ir->pi.result_lhs, ir->pi.temp_var) != 0) {
        fprintf(stderr, "aurc-native: pi result must divide the multiplication temporary\n");
        return 1;
    }

    int_binding *mul_lhs = find_binding(bindings, binding_count, ir->pi.temp_lhs);
    int_binding *mul_rhs = find_binding(bindings, binding_count, ir->pi.temp_rhs);
    int_binding *den_binding = find_binding(bindings, binding_count, ir->pi.result_rhs);

    if (!mul_lhs || !mul_rhs || !den_binding) {
        fprintf(stderr, "aurc-native: pi program references undefined integer bindings\n");
        return 1;
    }

    strncpy(ir->pi.numerator_var, mul_lhs->name, sizeof ir->pi.numerator_var - 1);
    ir->pi.numerator_var[sizeof ir->pi.numerator_var - 1] = '\0';
    ir->pi.numerator_value = mul_lhs->value;

    strncpy(ir->pi.scale_var, mul_rhs->name, sizeof ir->pi.scale_var - 1);
    ir->pi.scale_var[sizeof ir->pi.scale_var - 1] = '\0';
    ir->pi.scale_value = mul_rhs->value;

    strncpy(ir->pi.denominator_var, den_binding->name, sizeof ir->pi.denominator_var - 1);
    ir->pi.denominator_var[sizeof ir->pi.denominator_var - 1] = '\0';
    ir->pi.denominator_value = den_binding->value;

    ir->kind = PROGRAM_PI_TEST;
    return 0;
}

static int parse_source(FILE *fp, program_ir *ir) {
    char lines[256][2048];
    int line_count = 0;

    char buffer[2048];
    while (fgets(buffer, sizeof buffer, fp) != NULL) {
        char *line = trim(buffer);
        if (*line == '\0') {
            continue;
        }
        if (line_count >= 256) {
            fprintf(stderr, "aurc-native: input too large for MVP parser\n");
            return 1;
        }
        strncpy(lines[line_count], line, sizeof lines[line_count] - 1);
        lines[line_count][sizeof lines[line_count] - 1] = '\0';
        ++line_count;
    }

    int has_string_binding = 0;
    for (int i = 0; i < line_count; ++i) {
        if (strstr(lines[i], ": string =") != NULL) {
            has_string_binding = 1;
            break;
        }
    }

    int has_loop = 0;
    for (int i = 0; i < line_count; ++i) {
        if (strncmp(lines[i], "while", 5) == 0) {
            has_loop = 1;
            break;
        }
    }

    if (has_loop) {
        return parse_loop_sum_program(lines, line_count, ir);
    }

    int has_arithmetic_chain = 0;
    for (int i = 0; i < line_count; ++i) {
        if (strchr(lines[i], '*') != NULL || strchr(lines[i], '/') != NULL) {
            has_arithmetic_chain = 1;
            break;
        }
    }

    if (has_arithmetic_chain) {
        return parse_pi_program(lines, line_count, ir);
    }

    if (has_string_binding) {
        return parse_string_program(lines, line_count, ir);
    }

    fprintf(stderr, "aurc-native: unsupported program shape for MVP compiler\n");
    return 1;
}

static void write_escape_ascii(FILE *out, const char *literal) {
    fputs("ascii \"", out);
    for (const char *p = literal; *p; ++p) {
        if (*p == '\"') {
            fputs("\\\"", out);
        } else {
            fputc(*p, out);
        }
    }
    fputs("\"\n", out);
}

typedef enum runtime_feature {
    RUNTIME_NONE = 0,
    RUNTIME_PRINT_AND_EXIT = 1 << 0,
    RUNTIME_EXIT_WITH_R0 = 1 << 1
} runtime_feature;

static void emit_runtime_print_and_exit(FILE *out) {
    fputs("label __aur_runtime_print_and_exit\n", out);
    fputs("bytes 0x0B01010000000000  ; svc 0x01 write(stdout)\n", out);
    fputs("bytes 0x0B02000000000000  ; svc 0x02 exit(r0)\n", out);
    fputs("halt\n\n", out);
}

static void emit_runtime_exit_with_r0(FILE *out) {
    fputs("label __aur_runtime_exit_with_r0\n", out);
    fputs("bytes 0x0B02000000000000  ; svc 0x02 exit(r0)\n", out);
    fputs("halt\n\n", out);
}

static void emit_runtime_section(FILE *out, unsigned int flags) {
    if (flags & RUNTIME_PRINT_AND_EXIT) {
        emit_runtime_print_and_exit(out);
    }
    if (flags & RUNTIME_EXIT_WITH_R0) {
        emit_runtime_exit_with_r0(out);
    }
}

static int emit_string_manifest(const program_ir *ir, FILE *out, unsigned int *runtime_flags) {
    if (ir->print_binding_index < 0 || ir->print_binding_index >= ir->string_binding_count) {
        fprintf(stderr, "aurc-native: print binding not resolved for string program\n");
        return 1;
    }
    const string_binding *print_binding = &ir->bindings[ir->print_binding_index];

    fprintf(out, "# Aurora Minimal ISA manifest (manual draft)\n");
    fprintf(out, "header minimal_isa\n");
    fprintf(out, "org 0x0000\n");
    fprintf(out, "label main\n");

    char comment[256];
    snprintf(comment, sizeof comment, "mov r1, #addr(%s)", print_binding->name);
    emit_instruction_word(out, encode_mov_label(ISA_REG_R1), comment);
    emit_instruction_word(out, encode_mov_immediate(ISA_REG_R0, 0), "mov r0, #0");
    *runtime_flags |= RUNTIME_PRINT_AND_EXIT;
    fputc('\n', out);
    for (int i = 0; i < ir->string_binding_count; ++i) {
        const string_binding *binding = &ir->bindings[i];
        fprintf(out, "label %s\n", binding->name);
        write_escape_ascii(out, binding->literal);
        fprintf(out, "pad 0x0010\n");
    }
    return 0;
}

static int emit_loop_manifest(const program_ir *ir, FILE *out, unsigned int *runtime_flags) {
    fprintf(out, "# Minimal ISA manifest for arithmetic loop example\n");
    fprintf(out, "header minimal_isa\n");
    fprintf(out, "org 0x0000\n");
    fprintf(out, "label main\n");

    if (ensure_signed_32_range(ir->loop.accumulator_init, "accumulator initializer") != 0) {
        return 1;
    }
    if (ensure_signed_32_range(ir->loop.counter_init, "counter initializer") != 0) {
        return 1;
    }

    char comment[256];
    snprintf(comment, sizeof comment, "mov r1, #%d             ; accumulator", ir->loop.accumulator_init);
    emit_instruction_word(out, encode_mov_immediate(ISA_REG_R1, ir->loop.accumulator_init), comment);

    snprintf(comment, sizeof comment, "mov r2, #%d             ; counter", ir->loop.counter_init);
    emit_instruction_word(out, encode_mov_immediate(ISA_REG_R2, ir->loop.counter_init), comment);

    fprintf(out, "label loop\n");
    emit_instruction_word(out, encode_arith_reg_reg(ISA_OPCODE_ADD, ISA_REG_R1, ISA_REG_R1, ISA_REG_R2), "add r1, r1, r2         ; accumulator += counter");
    emit_instruction_word(out, encode_arith_reg_imm(ISA_OPCODE_SUB, ISA_REG_R2, ISA_REG_R2, 1), "sub r2, r2, #1         ; counter--");
    emit_instruction_word(out, encode_cmp_reg_imm(ISA_REG_R2, 0), "cmp r2, #0             ; compare with zero");
    emit_instruction_word(out, encode_cjmp(ISA_COND_EQ), "cjmp eq, exit          ; if zero -> exit");
    emit_instruction_word(out, encode_jmp(), "jmp loop               ; loop back (patched later)");
    fprintf(out, "label exit\n");
    emit_instruction_word(out, encode_mov_register(ISA_REG_R0, ISA_REG_R1), "mov r0, r1             ; move result into r0");
    *runtime_flags |= RUNTIME_EXIT_WITH_R0;
    return 0;
}

static int emit_pi_manifest(const program_ir *ir, FILE *out, unsigned int *runtime_flags) {
    fprintf(out, "# Minimal ISA manifest for pi approximation test\n");
    fprintf(out, "header minimal_isa\n");
    fprintf(out, "org 0x0000\n");
    fprintf(out, "label main\n");

    if (ensure_signed_32_range(ir->pi.numerator_value, "numerator initializer") != 0) {
        return 1;
    }
    if (ensure_signed_32_range(ir->pi.denominator_value, "denominator initializer") != 0) {
        return 1;
    }
    if (ensure_signed_32_range(ir->pi.scale_value, "scale initializer") != 0) {
        return 1;
    }

    char comment[256];
    snprintf(comment, sizeof comment, "mov r1, #%d             ; %s", ir->pi.numerator_value, ir->pi.numerator_var);
    emit_instruction_word(out, encode_mov_immediate(ISA_REG_R1, ir->pi.numerator_value), comment);

    snprintf(comment, sizeof comment, "mov r2, #%d             ; %s", ir->pi.denominator_value, ir->pi.denominator_var);
    emit_instruction_word(out, encode_mov_immediate(ISA_REG_R2, ir->pi.denominator_value), comment);

    snprintf(comment, sizeof comment, "mov r3, #%d             ; %s", ir->pi.scale_value, ir->pi.scale_var);
    emit_instruction_word(out, encode_mov_immediate(ISA_REG_R3, ir->pi.scale_value), comment);

    emit_instruction_word(out, encode_mul_reg_reg(ISA_REG_R4, ISA_REG_R1, ISA_REG_R3), "mul r4, r1, r3           ; temp = numerator * scale");
    emit_instruction_word(out, encode_rem_reg_reg(ISA_REG_R6, ISA_REG_R4, ISA_REG_R2), "rem r6, r4, r2           ; remainder (diagnostics)");
    emit_instruction_word(out, encode_div_reg_reg(ISA_REG_R5, ISA_REG_R4, ISA_REG_R2), "div r5, r4, r2           ; pi_scaled = temp / denominator");
    emit_instruction_word(out, encode_mov_register(ISA_REG_R0, ISA_REG_R5), "mov r0, r5             ; move result into r0");

    *runtime_flags |= RUNTIME_EXIT_WITH_R0;
    return 0;
}

static int emit_manifest(const program_ir *ir, const char *output_path) {
    FILE *out = fopen(output_path, "w");
    if (!out) {
        perror("aurc-native: fopen output");
        return 1;
    }

    unsigned int runtime_flags = RUNTIME_NONE;
    int rc = 1;
    if (ir->kind == PROGRAM_STRING) {
        rc = emit_string_manifest(ir, out, &runtime_flags);
    } else if (ir->kind == PROGRAM_LOOP_SUM) {
        rc = emit_loop_manifest(ir, out, &runtime_flags);
    } else if (ir->kind == PROGRAM_PI_TEST) {
        rc = emit_pi_manifest(ir, out, &runtime_flags);
    } else {
        fprintf(stderr, "aurc-native: unsupported program kind for emission\n");
    }

    if (rc == 0 && runtime_flags != RUNTIME_NONE) {
        fputc('\n', out);
        emit_runtime_section(out, runtime_flags);
    }

    fclose(out);
    return rc;
}

#ifdef _WIN32
static int make_temp_directory(char *buffer, size_t size) {
    char temp_path[MAX_PATH];
    if (!GetTempPathA(MAX_PATH, temp_path)) {
        fprintf(stderr, "aurc-native: failed to acquire temp path\n");
        return 1;
    }

    char temp_dir[MAX_PATH];
    if (!GetTempFileNameA(temp_path, "aur", 0, temp_dir)) {
        fprintf(stderr, "aurc-native: failed to allocate temp name\n");
        return 1;
    }

    DeleteFileA(temp_dir);
    if (_mkdir(temp_dir) != 0) {
        perror("aurc-native: mkdir temp");
        return 1;
    }

    strncpy(buffer, temp_dir, size - 1);
    buffer[size - 1] = '\0';
    return 0;
}

static int write_text_file(const char *path, const char *contents) {
    FILE *out = fopen(path, "w");
    if (!out) {
        perror("aurc-native: fopen temp file");
        return 1;
    }
    if (fputs(contents, out) == EOF) {
        perror("aurc-native: write temp file");
        fclose(out);
        return 1;
    }
    if (fclose(out) != 0) {
        perror("aurc-native: fclose temp file");
        return 1;
    }
    return 0;
}

static int escape_c_string(const char *input, char *output, size_t capacity) {
    size_t out_pos = 0;
    for (const unsigned char *p = (const unsigned char *)input; *p; ++p) {
        const char *escape_seq = NULL;
        char temp[5];
        switch (*p) {
            case '\\': escape_seq = "\\\\"; break;
            case '"': escape_seq = "\\\""; break;
            case '\n': escape_seq = "\\n"; break;
            case '\r': escape_seq = "\\r"; break;
            case '\t': escape_seq = "\\t"; break;
            case '\0': escape_seq = "\\0"; break;
            default:
                if (*p >= 32 && *p <= 126) {
                    temp[0] = (char)*p;
                    temp[1] = '\0';
                    escape_seq = temp;
                } else {
                    snprintf(temp, sizeof temp, "\\x%02X", *p);
                    escape_seq = temp;
                }
                break;
        }

        size_t len = strlen(escape_seq);
        if (out_pos + len >= capacity) {
            return 1;
        }
        memcpy(output + out_pos, escape_seq, len);
        out_pos += len;
    }

    if (out_pos >= capacity) {
        return 1;
    }
    output[out_pos] = '\0';
    return 0;
}

static int emit_c_source(const program_ir *ir, const char *path) {
    FILE *out = fopen(path, "w");
    if (!out) {
        perror("aurc-native: fopen generated C file");
        return 1;
    }

    fputs("#include <stdio.h>\n", out);
    fputs("#include <stdlib.h>\n\n", out);
    fputs("int main(void) {\n", out);

    if (ir->kind == PROGRAM_STRING) {
        if (ir->print_binding_index < 0 || ir->print_binding_index >= ir->string_binding_count) {
            fprintf(stderr, "aurc-native: unresolved print binding during C emission\n");
            fclose(out);
            return 1;
        }
        const string_binding *binding = &ir->bindings[ir->print_binding_index];
        char escaped[4096];
        if (escape_c_string(binding->literal, escaped, sizeof escaped) != 0) {
            fprintf(stderr, "aurc-native: failed to escape string literal for C output\n");
            fclose(out);
            return 1;
        }
        fprintf(out, "    const char *message = \"%s\";\n", escaped);
        fputs("    fputs(message, stdout);\n", out);
        fputs("    fflush(stdout);\n", out);
        fprintf(out, "    return %d;\n", ir->exit_value);
    } else if (ir->kind == PROGRAM_LOOP_SUM) {
        fprintf(out, "    long long %s = %d;\n", ir->loop.accumulator, ir->loop.accumulator_init);
        fprintf(out, "    long long %s = %d;\n", ir->loop.counter, ir->loop.counter_init);
        fprintf(out, "    while (%s > 0) {\n", ir->loop.counter);
        fprintf(out, "        %s = %s + %s;\n", ir->loop.accumulator, ir->loop.accumulator, ir->loop.counter);
        fprintf(out, "        %s = %s - 1;\n", ir->loop.counter, ir->loop.counter);
        fputs("    }\n", out);
        fprintf(out, "    return (int)%s;\n", ir->loop.accumulator);
    } else if (ir->kind == PROGRAM_PI_TEST) {
        fprintf(out, "    long long %s = %d;\n", ir->pi.numerator_var, ir->pi.numerator_value);
        fprintf(out, "    long long %s = %d;\n", ir->pi.denominator_var, ir->pi.denominator_value);
        fprintf(out, "    long long %s = %d;\n", ir->pi.scale_var, ir->pi.scale_value);
        fprintf(out, "    long long %s = %s * %s;\n", ir->pi.temp_var, ir->pi.numerator_var, ir->pi.scale_var);
        fprintf(out, "    long long remainder_value = %s %% %s;\n", ir->pi.temp_var, ir->pi.denominator_var);
        fprintf(out, "    (void)remainder_value;\n");
        fprintf(out, "    long long %s = %s / %s;\n", ir->pi.result_var, ir->pi.temp_var, ir->pi.denominator_var);
        fprintf(out, "    return (int)%s;\n", ir->pi.result_var);
    } else {
        fprintf(stderr, "aurc-native: unsupported program kind for C emission\n");
        fclose(out);
        return 1;
    }

    fputs("}\n", out);

    if (fclose(out) != 0) {
        perror("aurc-native: fclose generated C file");
        return 1;
    }
    return 0;
}

static int run_command(const char *cmd) {
    int rc = system(cmd);
    if (rc != 0) {
        fprintf(stderr, "aurc-native: command failed (%d): %s\n", rc, cmd);
    }
    return rc;
}

static int resolve_cl_path(char *buffer, size_t size) {
    const char *override = getenv("AURC_NATIVE_CL");
    if (override && *override) {
        size_t len = strlen(override);
        if (len + 1 > size) {
            fprintf(stderr, "aurc-native: AURC_NATIVE_CL path too long\n");
            return 1;
        }
        memcpy(buffer, override, len + 1);
        return 0;
    }

    char exe_path[MAX_PATH];
    DWORD exe_len = GetModuleFileNameA(NULL, exe_path, MAX_PATH);
    if (exe_len == 0 || exe_len >= MAX_PATH) {
        fprintf(stderr, "aurc-native: failed to determine executable path\n");
        return 1;
    }

    char build_dir[MAX_PATH];
    strncpy(build_dir, exe_path, sizeof build_dir - 1);
    build_dir[sizeof build_dir - 1] = '\0';

    char *sep = strrchr(build_dir, '\\');
    if (!sep) {
        return 1;
    }
    *sep = '\0'; /* drop exe name */
    sep = strrchr(build_dir, '\\');
    if (!sep) {
        return 1;
    }
    *sep = '\0'; /* drop configuration directory (Debug/Release) */

    char cache_path[MAX_PATH];
    if (snprintf(cache_path, sizeof cache_path, "%s\\CMakeCache.txt", build_dir) >= (int)sizeof cache_path) {
        return 1;
    }

    FILE *cache = fopen(cache_path, "r");
    if (cache) {
        char line[1024];
        while (fgets(line, sizeof line, cache) != NULL) {
            if (strncmp(line, "CMAKE_LINKER:FILEPATH=", 23) == 0) {
                char *value = line + 23;
                char *newline = strpbrk(value, "\r\n");
                if (newline) {
                    *newline = '\0';
                }
                char linker_path[MAX_PATH];
                strncpy(linker_path, value, sizeof linker_path - 1);
                linker_path[sizeof linker_path - 1] = '\0';
                for (char *iter = linker_path; *iter; ++iter) {
                    if (*iter == '/') {
                        *iter = '\\';
                    }
                }
                char *link_sep = strrchr(linker_path, '\\');
                if (!link_sep) {
                    link_sep = strrchr(linker_path, '/');
                }
                if (link_sep) {
                    *link_sep = '\0';
                    char candidate[MAX_PATH];
                    if (snprintf(candidate, sizeof candidate, "%s\\cl.exe", linker_path) < (int)sizeof candidate) {
                        DWORD attrs = GetFileAttributesA(candidate);
                        if (attrs != INVALID_FILE_ATTRIBUTES) {
                            size_t len = strlen(candidate);
                            if (len + 1 <= size) {
                                memcpy(buffer, candidate, len + 1);
                                fclose(cache);
                                return 0;
                            }
                        }
                    }
                }
                break;
            }
        }
        fclose(cache);
    }

    if (snprintf(buffer, size, "%s", "cl") >= (int)size) {
        return 1;
    }
    return 0;
}
#endif /* _WIN32 */

static int validate_program(program_ir *ir) {
    if (ir->kind == PROGRAM_STRING) {
        if (ir->string_binding_count == 0) {
            fprintf(stderr, "aurc-native: expected at least one string binding\n");
            return 1;
        }
        if (!ir->have_print) {
            fprintf(stderr, "aurc-native: expected print service call\n");
            return 1;
        }
        if (!ir->have_exit || !ir->have_return) {
            fprintf(stderr, "aurc-native: expected exit + return statements\n");
            return 1;
        }
        int idx = ir->print_binding_index;
        if (idx < 0 || idx >= ir->string_binding_count) {
            idx = find_string_binding_index(ir, ir->print_arg);
            if (idx < 0) {
                fprintf(stderr, "aurc-native: print argument must reference a string binding\n");
                return 1;
            }
            ir->print_binding_index = idx;
        }
        const string_binding *binding = &ir->bindings[ir->print_binding_index];
        if (strcmp(ir->print_arg, binding->name) != 0) {
            fprintf(stderr, "aurc-native: print argument must match resolved binding name\n");
            return 1;
        }
        if (ir->exit_value != ir->return_value) {
            fprintf(stderr, "aurc-native: exit and return values must match\n");
            return 1;
        }
        if (ir->exit_value != 0) {
            fprintf(stderr, "aurc-native: only exit code 0 supported in Stage N1 skeleton\n");
            return 1;
        }
    } else if (ir->kind == PROGRAM_LOOP_SUM) {
        if (ir->loop.accumulator[0] == '\0' || ir->loop.counter[0] == '\0') {
            fprintf(stderr, "aurc-native: loop lowering missing accumulator/counter\n");
            return 1;
        }
        if (strcmp(ir->loop.exit_var, ir->loop.accumulator) != 0 || strcmp(ir->loop.return_var, ir->loop.accumulator) != 0) {
            fprintf(stderr, "aurc-native: exit/return must target accumulator\n");
            return 1;
        }
    } else if (ir->kind == PROGRAM_PI_TEST) {
        if (ir->pi.numerator_var[0] == '\0' || ir->pi.denominator_var[0] == '\0' || ir->pi.scale_var[0] == '\0') {
            fprintf(stderr, "aurc-native: pi program missing required bindings\n");
            return 1;
        }
        if (ir->pi.denominator_value == 0) {
            fprintf(stderr, "aurc-native: pi program denominator must be non-zero\n");
            return 1;
        }
        if (strcmp(ir->pi.result_var, ir->pi.exit_var) != 0 || strcmp(ir->pi.return_var, ir->pi.result_var) != 0) {
            fprintf(stderr, "aurc-native: pi program exit/return must target division result\n");
            return 1;
        }
    } else {
        fprintf(stderr, "aurc-native: unrecognised program kind\n");
        return 1;
    }

    return 0;
}

static int load_program_ir(const char *input_path, program_ir *ir) {
    memset(ir, 0, sizeof *ir);
    ir->print_binding_index = -1;

    FILE *fp = fopen(input_path, "r");
    if (!fp) {
        perror("aurc-native: fopen input");
        return 1;
    }

    int rc = parse_source(fp, ir);
    fclose(fp);
    if (rc != 0) {
        return 1;
    }

    return validate_program(ir);
}

static int hex_value(int c) {
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
        return 10 + (c - 'a');
    }
    if (c >= 'A' && c <= 'F') {
        return 10 + (c - 'A');
    }
    return -1;
}

static int emit_hex_bytes(FILE *out, const char *hex) {
    int high = -1;
    size_t written = 0;

    for (const char *p = hex; *p; ++p) {
        if (*p == ';' || isspace((unsigned char)*p)) {
            break;
        }
        if (*p == '_') {
            continue;
        }
        int v = hex_value((unsigned char)*p);
        if (v < 0) {
            fprintf(stderr, "aurc-native: invalid hex digit '%c' in bytes directive\n", *p);
            return 1;
        }
        if (high < 0) {
            high = v;
        } else {
            unsigned char byte = (unsigned char)((high << 4) | v);
            if (fputc(byte, out) == EOF) {
                perror("aurc-native: write bytes");
                return 1;
            }
            written++;
            high = -1;
        }
    }

    if (high >= 0) {
        fprintf(stderr, "aurc-native: odd number of hex digits in bytes directive\n");
        return 1;
    }

    if (written == 0) {
        fprintf(stderr, "aurc-native: bytes directive did not contain any data\n");
        return 1;
    }

    return 0;
}

static int emit_ascii_bytes(FILE *out, const char *line) {
    const char *start = strchr(line, '"');
    if (!start) {
        fprintf(stderr, "aurc-native: ascii directive missing opening quote\n");
        return 1;
    }
    start++;
    const char *p = start;
    while (*p) {
        if (*p == '"') {
            break;
        }
        unsigned char ch;
        if (*p == '\\') {
            ++p;
            if (*p == '\0') {
                fprintf(stderr, "aurc-native: incomplete escape sequence in ascii directive\n");
                return 1;
            }
            switch (*p) {
                case '\\': ch = '\\'; break;
                case '"': ch = '"'; break;
                case 'n': ch = '\n'; break;
                case 'r': ch = '\r'; break;
                case 't': ch = '\t'; break;
                case '0': ch = '\0'; break;
                default:
                    fprintf(stderr, "aurc-native: unsupported escape sequence \\%c\n", *p);
                    return 1;
            }
        } else {
            ch = (unsigned char)*p;
        }
        if (fputc(ch, out) == EOF) {
            perror("aurc-native: write ascii");
            return 1;
        }
        ++p;
    }

    if (*p != '"') {
        fprintf(stderr, "aurc-native: ascii directive missing closing quote\n");
        return 1;
    }

    return 0;
}

static int emit_pad(FILE *out, const char *line) {
    const char *value = line + 3;
    while (*value && isspace((unsigned char)*value)) {
        ++value;
    }
    if (*value == '\0') {
        fprintf(stderr, "aurc-native: pad directive missing value\n");
        return 1;
    }
    char *endptr = NULL;
    unsigned long count = strtoul(value, &endptr, 0);
    if (endptr == value) {
        fprintf(stderr, "aurc-native: pad directive has invalid value\n");
        return 1;
    }
    unsigned char zero = 0;
    for (unsigned long i = 0; i < count; ++i) {
        if (fputc(zero, out) == EOF) {
            perror("aurc-native: write pad");
            return 1;
        }
    }
    return 0;
}

int aurc_assemble_manifest(const char *manifest_path, const char *binary_path) {
    FILE *in = fopen(manifest_path, "r");
    if (!in) {
        perror("aurc-native: fopen manifest");
        return 1;
    }

    FILE *out = fopen(binary_path, "wb");
    if (!out) {
        perror("aurc-native: fopen binary");
        fclose(in);
        return 1;
    }

    char buffer[4096];
    int rc = 0;

    while (fgets(buffer, sizeof buffer, in) != NULL) {
        char *line = trim(buffer);
        if (*line == '\0' || *line == '#') {
            continue;
        }

        if (strncmp(line, "bytes", 5) == 0) {
            const char *hex = strstr(line, "0x");
            if (!hex) {
                fprintf(stderr, "aurc-native: bytes directive missing 0x literal\n");
                rc = 1;
                break;
            }
            hex += 2;
            if (emit_hex_bytes(out, hex) != 0) {
                rc = 1;
                break;
            }
            continue;
        }

        if (strncmp(line, "ascii", 5) == 0) {
            if (emit_ascii_bytes(out, line) != 0) {
                rc = 1;
                break;
            }
            continue;
        }

        if (strncmp(line, "pad", 3) == 0) {
            if (emit_pad(out, line) != 0) {
                rc = 1;
                break;
            }
            continue;
        }

        if (strncmp(line, "halt", 4) == 0) {
            unsigned char halt_bytes[8] = {0};
            halt_bytes[0] = 0x0C;
            if (fwrite(halt_bytes, 1, sizeof halt_bytes, out) != sizeof halt_bytes) {
                perror("aurc-native: write halt");
                rc = 1;
                break;
            }
            continue;
        }

        /* header/org/label and other directives do not translate to raw bytes */
    }

    fclose(in);
    if (fclose(out) != 0) {
        perror("aurc-native: fclose binary");
        rc = 1;
    }

    return rc;
}

int aurc_compile_file(const char *input_path, const char *output_path) {
    program_ir ir;
    if (load_program_ir(input_path, &ir) != 0) {
        return 1;
    }

    return emit_manifest(&ir, output_path);
}

int aurc_compile_to_exe(const char *input_path, const char *exe_path) {
    program_ir ir;
    if (load_program_ir(input_path, &ir) != 0) {
        return 1;
    }

#ifndef _WIN32
    (void)exe_path;
    fprintf(stderr, "aurc-native: --emit-exe currently supported on Windows hosts only\n");
    return 1;
#else
    char temp_dir[MAX_PATH] = {0};
    char c_path[MAX_PATH] = {0};
    char built_exe[MAX_PATH] = {0};
    char temp_obj[MAX_PATH] = {0};
    char temp_pdb[MAX_PATH] = {0};
    char orig_dir[MAX_PATH] = {0};
    int have_temp_dir = 0;
    int generated_source = 0;
    int built_binary = 0;
    int changed_dir = 0;
    int rc = 0;
    char cl_path[MAX_PATH] = {0};

    if (resolve_cl_path(cl_path, sizeof cl_path) != 0) {
        fprintf(stderr, "aurc-native: unable to locate cl.exe; ensure Visual Studio Build Tools are installed\n");
        return 1;
    }

    if (make_temp_directory(temp_dir, sizeof temp_dir) != 0) {
        return 1;
    }
    have_temp_dir = 1;

    if (snprintf(c_path, sizeof c_path, "%s%c%s", temp_dir, '\\', "aurc_generated.c") >= (int)sizeof c_path) {
        fprintf(stderr, "aurc-native: temp path too long for generated C stub\n");
        rc = 1;
        goto cleanup;
    }

    if (emit_c_source(&ir, c_path) != 0) {
        rc = 1;
        goto cleanup;
    }
    generated_source = 1;

    if (!_getcwd(orig_dir, (int)sizeof orig_dir)) {
        perror("aurc-native: getcwd before cl");
        rc = 1;
        goto cleanup;
    }
    if (_chdir(temp_dir) != 0) {
        perror("aurc-native: chdir temp");
        rc = 1;
        goto cleanup;
    }
    changed_dir = 1;

    char command[1024];
    if (snprintf(command, sizeof command, "\"%s\" /nologo /Ox /std:c17 /Feaurc_generated.exe /Foaurs_temp.obj /Fdaurs_temp.pdb aurc_generated.c", cl_path) >= (int)sizeof command) {
        fprintf(stderr, "aurc-native: command buffer too small for cl invocation\n");
        rc = 1;
        goto cleanup;
    }

    rc = run_command(command);
    if (rc != 0) {
        goto cleanup;
    }

    if (_chdir(orig_dir) != 0) {
        perror("aurc-native: restore cwd after cl");
        rc = 1;
        goto cleanup;
    }
    changed_dir = 0;

    if (snprintf(built_exe, sizeof built_exe, "%s%c%s", temp_dir, '\\', "aurc_generated.exe") >= (int)sizeof built_exe) {
        fprintf(stderr, "aurc-native: temp path too long for generated exe\n");
        rc = 1;
        goto cleanup;
    }
    if (!CopyFileA(built_exe, exe_path, FALSE)) {
        fprintf(stderr, "aurc-native: failed to copy generated exe to destination\n");
        rc = 1;
        goto cleanup;
    }
    built_binary = 1;

    if (snprintf(temp_obj, sizeof temp_obj, "%s%c%s", temp_dir, '\\', "aurs_temp.obj") < (int)sizeof temp_obj) {
        DeleteFileA(temp_obj);
    }
    if (snprintf(temp_pdb, sizeof temp_pdb, "%s%c%s", temp_dir, '\\', "aurs_temp.pdb") < (int)sizeof temp_pdb) {
        DeleteFileA(temp_pdb);
    }
    DeleteFileA(built_exe);
    DeleteFileA(c_path);
    RemoveDirectoryA(temp_dir);
    return 0;

cleanup:
    if (changed_dir) {
        _chdir(orig_dir);
    }
    if (built_binary && built_exe[0] != '\0') {
        DeleteFileA(built_exe);
    }
    if (generated_source && c_path[0] != '\0') {
        DeleteFileA(c_path);
    }
    if (have_temp_dir) {
        if (temp_obj[0] == '\0' && snprintf(temp_obj, sizeof temp_obj, "%s%c%s", temp_dir, '\\', "aurs_temp.obj") < (int)sizeof temp_obj) {
            DeleteFileA(temp_obj);
        } else if (temp_obj[0] != '\0') {
            DeleteFileA(temp_obj);
        }
        if (temp_pdb[0] == '\0' && snprintf(temp_pdb, sizeof temp_pdb, "%s%c%s", temp_dir, '\\', "aurs_temp.pdb") < (int)sizeof temp_pdb) {
            DeleteFileA(temp_pdb);
        } else if (temp_pdb[0] != '\0') {
            DeleteFileA(temp_pdb);
        }
        RemoveDirectoryA(temp_dir);
    }
    return rc != 0 ? rc : 1;
#endif
}
