cmake_minimum_required(VERSION 3.16)

project(aurc_native C)

set(CMAKE_C_STANDARD 17)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

set(SRC_DIR ${CMAKE_CURRENT_SOURCE_DIR}/src)
file(GLOB SRC_FILES CONFIGURE_DEPENDS ${SRC_DIR}/*.c)

add_executable(aurc-native ${SRC_FILES})

target_include_directories(aurc-native PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

if (MSVC)
    target_compile_options(aurc-native PRIVATE /W4)
else()
    target_compile_options(aurc-native PRIVATE -Wall -Wextra -pedantic)
endif()