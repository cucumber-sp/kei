/* Kei runtime — minimal C runtime for compiled Kei programs */
#ifndef KEI_RUNTIME_H
#define KEI_RUNTIME_H

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>

/* String type — for now just a const char* alias */
typedef const char* kei_string;

/* Panic — prints message and aborts */
static void kei_panic(const char* msg) {
    fprintf(stderr, "panic: %s\n", msg);
    exit(1);
}

/* Print functions */
static void kei_print_string(kei_string s) {
    printf("%s\n", s);
}

static void kei_print_int(int64_t v) {
    printf("%lld\n", (long long)v);
}

static void kei_print_float(double v) {
    printf("%g\n", v);
}

static void kei_print_bool(bool v) {
    printf("%s\n", v ? "true" : "false");
}

/* Bounds check */
static void kei_bounds_check(int64_t index, int64_t length) {
    if (index < 0 || index >= length) {
        fprintf(stderr, "panic: index out of bounds: index %lld, length %lld\n",
                (long long)index, (long long)length);
        exit(1);
    }
}

/* Null check */
static void kei_null_check(const void* ptr) {
    if (ptr == NULL) {
        kei_panic("null pointer dereference");
    }
}

/* Assert check */
static void kei_assert(bool cond, const char* msg) {
    if (!cond) {
        fprintf(stderr, "assertion failed: %s\n", msg);
        exit(1);
    }
}

/* Require check */
static void kei_require(bool cond, const char* msg) {
    if (!cond) {
        fprintf(stderr, "requirement failed: %s\n", msg);
        exit(1);
    }
}

#endif /* KEI_RUNTIME_H */
