/* Kei runtime — minimal C runtime for compiled Kei programs */
#ifndef KEI_RUNTIME_H
#define KEI_RUNTIME_H

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>

/* ─── String type — COW refcounted string ─────────────────────────────────── */

typedef struct {
    char* data;      /* heap-allocated or static pointer */
    int64_t len;     /* byte length (not including null terminator) */
    int64_t cap;     /* allocated capacity (0 for literals) */
    int64_t* ref;    /* refcount pointer (NULL for static/literal strings) */
} kei_string;

/* Create a string from a C string literal (no allocation, ref=NULL) */
static kei_string kei_string_literal(const char* s) {
    kei_string r;
    r.data = (char*)s;
    r.len = (int64_t)strlen(s);
    r.cap = 0;
    r.ref = NULL;
    return r;
}

/* Increment refcount (COW copy) */
static kei_string kei_string_copy(kei_string s) {
    if (s.ref != NULL) {
        (*s.ref)++;
    }
    return s;
}

/* Decrement refcount, free if zero */
static void kei_string_destroy(kei_string* s) {
    if (s->ref != NULL) {
        (*s->ref)--;
        if (*s->ref <= 0) {
            free(s->data);
            free(s->ref);
        }
        s->ref = NULL;
        s->data = NULL;
    }
}

/* Allocate a new string with given capacity */
static kei_string kei_string_alloc(int64_t len) {
    kei_string r;
    r.cap = len + 1;
    r.data = (char*)malloc((size_t)r.cap);
    r.len = len;
    r.ref = (int64_t*)malloc(sizeof(int64_t));
    *r.ref = 1;
    r.data[len] = '\0';
    return r;
}

/* Concatenate two strings — always allocates a new string */
static kei_string kei_string_concat(kei_string a, kei_string b) {
    int64_t newLen = a.len + b.len;
    kei_string r = kei_string_alloc(newLen);
    memcpy(r.data, a.data, (size_t)a.len);
    memcpy(r.data + a.len, b.data, (size_t)b.len);
    r.data[newLen] = '\0';
    return r;
}

/* Return string length */
static int64_t kei_string_len(kei_string s) {
    return s.len;
}

/* Compare two strings for equality */
static bool kei_string_eq(kei_string a, kei_string b) {
    if (a.len != b.len) return false;
    if (a.data == b.data) return true;
    return memcmp(a.data, b.data, (size_t)a.len) == 0;
}

/* Substring — allocates a new string [start, end) */
static kei_string kei_string_substr(kei_string s, int64_t start, int64_t end) {
    if (start < 0) start = 0;
    if (end > s.len) end = s.len;
    if (start >= end) {
        return kei_string_literal("");
    }
    int64_t newLen = end - start;
    kei_string r = kei_string_alloc(newLen);
    memcpy(r.data, s.data + start, (size_t)newLen);
    r.data[newLen] = '\0';
    return r;
}

/* ─── Panic ───────────────────────────────────────────────────────────────── */

static void kei_panic(const char* msg) {
    fprintf(stderr, "panic: %s\n", msg);
    exit(1);
}

/* ─── Print functions ─────────────────────────────────────────────────────── */

static void kei_print_string(kei_string s) {
    printf("%.*s\n", (int)s.len, s.data);
}

static void kei_print_i32(int32_t v) {
    printf("%d\n", (int)v);
}

static void kei_print_i64(int64_t v) {
    printf("%lld\n", (long long)v);
}

static void kei_print_f32(float v) {
    printf("%g\n", (double)v);
}

static void kei_print_f64(double v) {
    printf("%g\n", v);
}

static void kei_print_bool(bool v) {
    printf("%s\n", v ? "true" : "false");
}

/* ─── Bounds check ────────────────────────────────────────────────────────── */

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
