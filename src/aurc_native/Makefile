# Stage N1 native Aurora compiler Makefile (initial scaffold)

CC ?= cc
CFLAGS ?= -std=c17 -Wall -Wextra -pedantic -Iinclude
LDFLAGS ?=
SRC_DIR := src
OBJ_DIR := build

SRCS := $(wildcard $(SRC_DIR)/*.c)
OBJS := $(patsubst $(SRC_DIR)/%.c,$(OBJ_DIR)/%.o,$(SRCS))
TARGET := aurc-native

.PHONY: all clean run test

all: $(TARGET)

$(TARGET): $(OBJS)
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $^ $(LDFLAGS) -o $@

$(OBJ_DIR)/%.o: $(SRC_DIR)/%.c | $(OBJ_DIR)
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

$(OBJ_DIR):
	@mkdir -p $(OBJ_DIR)

run: $(TARGET)
	@mkdir -p build
	./$(TARGET) compile ../../examples/hello_world.aur -o build/hello_native.aurs
	diff -u ../../examples/hello_world.aurs build/hello_native.aurs

clean:
	rm -rf $(OBJ_DIR) $(TARGET)

test: $(TARGET)
	@mkdir -p build
	./$(TARGET) compile ../../examples/hello_world.aur -o build/hello_native.aurs
	diff -u ../../examples/hello_world.aurs build/hello_native.aurs
