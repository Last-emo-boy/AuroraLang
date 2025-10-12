#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "aurc_native.h"

static void usage(const char *program) {
    fprintf(stderr, "Usage: %s compile <input.aur> [-o output.aurs] [--emit-bin output.bin] [--emit-exe output.exe]\n", program);
}

int main(int argc, char **argv) {
    if (argc < 3) {
        usage(argv[0]);
        return EXIT_FAILURE;
    }

    if (strcmp(argv[1], "compile") != 0) {
        usage(argv[0]);
        return EXIT_FAILURE;
    }

    const char *input_path = argv[2];
    const char *output_path = NULL;
    const char *binary_path = NULL;
    const char *exe_path = NULL;

    for (int i = 3; i < argc; ++i) {
        if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
            if (i + 1 >= argc) {
                fprintf(stderr, "Missing argument for %s\n", argv[i]);
                return EXIT_FAILURE;
            }
            output_path = argv[i + 1];
            ++i;
        } else if (strcmp(argv[i], "--emit-bin") == 0) {
            if (i + 1 >= argc) {
                fprintf(stderr, "Missing argument for %s\n", argv[i]);
                return EXIT_FAILURE;
            }
            binary_path = argv[i + 1];
            ++i;
        } else if (strcmp(argv[i], "--emit-exe") == 0) {
            if (i + 1 >= argc) {
                fprintf(stderr, "Missing argument for %s\n", argv[i]);
                return EXIT_FAILURE;
            }
            exe_path = argv[i + 1];
            ++i;
        } else {
            fprintf(stderr, "Unknown argument: %s\n", argv[i]);
            usage(argv[0]);
            return EXIT_FAILURE;
        }
    }

    if (output_path == NULL) {
        fprintf(stderr, "Output path required for now.\n");
        return EXIT_FAILURE;
    }

    int rc = aurc_compile_file(input_path, output_path);
    if (rc != 0) {
        fprintf(stderr, "aurc-native: compilation failed (code %d)\n", rc);
        return EXIT_FAILURE;
    }

    printf("[aurc-native] wrote manifest to %s\n", output_path);

    if (binary_path != NULL) {
        rc = aurc_assemble_manifest(output_path, binary_path);
        if (rc != 0) {
            fprintf(stderr, "aurc-native: assembling manifest failed (code %d)\n", rc);
            return EXIT_FAILURE;
        }
        printf("[aurc-native] wrote binary to %s\n", binary_path);
    }

    if (exe_path != NULL) {
        rc = aurc_compile_to_exe(input_path, exe_path);
        if (rc != 0) {
            fprintf(stderr, "aurc-native: exe generation failed (code %d)\n", rc);
            return EXIT_FAILURE;
        }
        printf("[aurc-native] wrote executable to %s\n", exe_path);
    }

    return EXIT_SUCCESS;
}
