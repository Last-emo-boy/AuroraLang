#ifndef AURC_NATIVE_H
#define AURC_NATIVE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

struct aurc_buffer {
    const char *data;
    size_t len;
};

int aurc_compile_file(const char *input_path, const char *output_path);
int aurc_assemble_manifest(const char *manifest_path, const char *binary_path);
int aurc_compile_to_exe(const char *input_path, const char *exe_path);

#ifdef __cplusplus
}
#endif

#endif /* AURC_NATIVE_H */
