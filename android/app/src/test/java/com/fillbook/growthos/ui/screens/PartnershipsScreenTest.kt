package com.fillbook.growthos.ui.screens

import com.fillbook.growthos.data.PartnershipStage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PartnershipsScreenTest {
    @Test
    fun `the pitch is editable while still a candidate -- qualified and draft_ready`() {
        assertTrue(isPitchStillEditable(PartnershipStage.QUALIFIED))
        assertTrue(isPitchStillEditable(PartnershipStage.DRAFT_READY))
    }

    @Test
    fun `the pitch is read-only from CONTACTED onward -- it's history, not a candidate anymore`() {
        assertFalse(isPitchStillEditable(PartnershipStage.CONTACTED))
        assertFalse(isPitchStillEditable(PartnershipStage.REPLIED))
        assertFalse(isPitchStillEditable(PartnershipStage.PILOT))
        assertFalse(isPitchStillEditable(PartnershipStage.ACTIVE_PARTNER))
        assertFalse(isPitchStillEditable(PartnershipStage.CLOSED))
        assertFalse(isPitchStillEditable(PartnershipStage.ARCHIVED))
        assertFalse(isPitchStillEditable(PartnershipStage.DO_NOT_CONTACT))
    }

    @Test
    fun `a brand-new prospect with no draft yet is also not editable`() {
        assertFalse(isPitchStillEditable(PartnershipStage.PROSPECT))
    }

    @Test
    fun `extracts the bare handle from a real contactRoute string`() {
        assertEquals("phinloco", extractXHandle("X DM: @phinloco"))
        assertEquals("wannabechamp", extractXHandle("X DM: @wannabechamp"))
    }

    @Test
    fun `returns null when no handle can be parsed, so the caller can fall back instead of opening a broken URL`() {
        assertNull(extractXHandle(null))
        assertNull(extractXHandle("email: dana@example.com")) // an email route, not an X route
        assertNull(extractXHandle("X DM: unknown"))
    }
}
