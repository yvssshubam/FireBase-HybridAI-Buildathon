package com.fairclaim.customer.data

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue

// Bridge between Firestore's types and the plain maps the (unit-tested) mappers and batch
// builders use.

/** Timestamp → whole epoch millis (Decisions: `ts.toDate().time`, i.e. nanos floored). */
fun Timestamp.millis(): Long = toDate().time

fun plain(v: Any?): Any? = when (v) {
    is Timestamp -> v.millis()
    is Map<*, *> -> v.entries.associate { (k, value) -> k.toString() to plain(value) }
    is List<*> -> v.map(::plain)
    else -> v
}

@Suppress("UNCHECKED_CAST")
fun DocumentSnapshot.plainData(): Map<String, Any?>? = data?.let { plain(it) as Map<String, Any?> }

/** [ServerTimestamp] → FieldValue.serverTimestamp(), recursively. */
fun toFirestore(v: Any?): Any? = when (v) {
    ServerTimestamp -> FieldValue.serverTimestamp()
    is Map<*, *> -> v.entries.associate { (k, value) -> k.toString() to toFirestore(value) }
    is List<*> -> v.map(::toFirestore)
    else -> v
}

@Suppress("UNCHECKED_CAST")
fun Doc.forFirestore(): Map<String, Any?> = toFirestore(this) as Map<String, Any?>
