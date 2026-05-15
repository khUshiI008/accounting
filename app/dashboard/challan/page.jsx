"use client";
import { useEffect, useState } from "react";
import QuickAddItemModal from "@/components/QuickAddItemModal";
import QuickAddPartyModal from "@/components/QuickAddPartyModal";

export default function Challans() {
  const [showForm, setShowForm] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewData, setViewData] = useState(null);
  const [challans, setChallans] = useState([]);
  const [items, setItems] = useState([]);
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [showQuickAddItem, setShowQuickAddItem] = useState(false);
  const [showQuickAddParty, setShowQuickAddParty] = useState(false);
   const [mounted, setMounted] = useState(false);
    
   useEffect(() => {
    setMounted(true);  // ← add this line to the existing useEffect, or add a new one
  }, []);
  const [formData, setFormData] = useState({
    party: "",
    itemsList: [],
    amount: "",
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const fetchChallans = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/challan", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to fetch");
      }
      const data = await res.json();
      setChallans(data.challans);
    } catch (err) {
      console.error("Fetch Challans Error:", err.message);
    }
  };

  const fetchParties = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/parties", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setParties(data.parties);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchItems = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/items", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setItems(data.items);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    const fetchAllData = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchChallans(), fetchParties(), fetchItems()]);
      } catch (err) {
        console.error("Error fetching data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchAllData();
  }, []);

  const handleItemAdded = (newItem) => {
    setItems((prev) => [...prev, newItem]);
  };

  const handlePartyAdded = (newParty) => {
    setParties((prev) => [...prev, newParty]);
    setFormData((prev) => ({ ...prev, party: newParty.id }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem("token");
      const method = editId ? "PUT" : "POST";
      const res = await fetch("/api/challan", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editId ? { ...formData, id: editId } : formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      setFormData({ party: "", itemsList: [], amount: "" });
      setEditId(null);
      setShowForm(false);
      fetchChallans();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this challan?")) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/challan", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      fetchChallans();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEdit = (c) => {
    setFormData({
      party: c.party_id || "",
      amount: c.amount || "",
      itemsList:
        c.items?.map((it) => ({
          id: it.item_id,
          name: it.name,
          qty: it.quantity,
        })) || [],
    });
    setEditId(c.id);
    setShowForm(true);
  };

  const handleView = (challan) => {
    setViewData(challan);
    setShowViewModal(true);
  };

  const openAddForm = () => {
    setFormData({ party: "", itemsList: [], amount: "" });
    setEditId(null);
    setShowForm(true);
  };

  const addItem = (id) => {
    const item = items.find((i) => i.id == id);
    if (!item) return;
    setFormData((prev) => ({
      ...prev,
      itemsList: [...(prev.itemsList || []), { id: item.id, name: item.name, qty: 1 }],
    }));
  };

  const updateItemQty = (index, value) => {
    const updated = [...formData.itemsList];
    updated[index].qty = Number(value);
    setFormData({ ...formData, itemsList: updated });
  };

  const removeItem = (index) => {
    setFormData({
      ...formData,
      itemsList: formData.itemsList.filter((_, i) => i !== index),
    });
  };
    if (!mounted) return null;  
  return (
    <div className="min-h-screen bg-gray-50">

      {/* Page Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Challans</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage your challan records</p>
        </div>
        <button
          onClick={openAddForm}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-sm"
        >
          <span className="text-lg leading-none">+</span>
          Add Challan
        </button>
      </div>

      {/* Table Card */}
      <div className="mx-8 mt-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="divide-y divide-gray-100">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-4 px-6 py-4 animate-pulse">
                  <div className="h-4 bg-gray-100 rounded w-32" />
                  <div className="h-4 bg-gray-100 rounded w-24" />
                  <div className="h-4 bg-gray-100 rounded w-28 ml-auto" />
                  <div className="h-4 bg-gray-100 rounded w-32" />
                </div>
              ))}
            </div>
          ) : challans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <span className="text-5xl mb-4">📋</span>
              <p className="text-base font-medium text-gray-500">No challans yet</p>
              <p className="text-sm mt-1">Click "Add Challan" to create your first challan.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Party</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Items</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {challans.map((challan) => (
                    <tr key={challan.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-gray-700 font-medium">{challan.party_name}</td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-block px-2.5 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                          {challan.total_items ?? challan.items?.length ?? 0} items
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-gray-900">
                        ₹{challan.amount}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleView(challan)}
                            className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-colors"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleEdit(challan)}
                            className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(challan.id)}
                            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && challans.length > 0 && (
          <p className="text-xs text-gray-400 mt-3 px-1">
            {challans.length} challan{challans.length !== 1 ? "s" : ""} total
          </p>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm overflow-y-auto p-6"
          onClick={(e) => e.target === e.currentTarget && setShowForm(false)}
        >
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden my-8">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                {editId ? "Edit Challan" : "Add New Challan"}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="px-6 py-5 space-y-6 max-h-[calc(100vh-200px)] overflow-y-auto">

                {/* Party */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <span className="w-1 h-4 bg-blue-500 rounded-full"></span>
                    Party
                  </h3>
                  <div className="flex items-end gap-3">
                    <div className="flex-1 flex flex-col gap-1.5">
                      <select
                        name="party"
                        value={formData.party}
                        onChange={handleChange}
                        className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition"
                        required
                      >
                        <option value="">Select Party</option>
                        {parties.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.party_type?.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())})
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowQuickAddParty(true)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 px-3 py-2.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors whitespace-nowrap"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Quick Add
                    </button>
                  </div>
                </div>

                {/* Items */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <span className="w-1 h-4 bg-green-500 rounded-full"></span>
                      Items
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowQuickAddItem(true)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Quick Add Item
                    </button>
                  </div>

                  <select
                    onChange={(e) => { addItem(e.target.value); e.target.value = ""; }}
                    className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition w-full md:w-64 mb-3"
                  >
                    <option value="">+ Add Item</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-gray-200 rounded-lg">
                      <thead className="bg-gray-50">
                        <tr className="border-b border-gray-200">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Item</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Quantity</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {formData.itemsList?.length === 0 ? (
                          <tr>
                            <td colSpan="3" className="px-4 py-8 text-center text-gray-400">
                              No items added yet
                            </td>
                          </tr>
                        ) : (
                          formData.itemsList.map((it, index) => (
                            <tr key={index} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-gray-700">{it.name}</td>
                              <td className="px-4 py-3 text-center">
                                <input
                                  type="number"
                                  value={it.qty}
                                  min={1}
                                  onChange={(e) => updateItemQty(index, e.target.value)}
                                  className="border border-gray-200 rounded-lg px-2 py-1.5 w-20 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                              </td>
                              <td className="px-4 py-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeItem(index)}
                                  className="text-red-500 hover:text-red-700 font-medium text-sm"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <span className="w-1 h-4 bg-purple-500 rounded-full"></span>
                    Amount
                  </h3>
                  <div className="relative w-full md:w-56">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">₹</span>
                    <input
                      type="number"
                      name="amount"
                      placeholder="0.00"
                      value={formData.amount}
                      onChange={handleChange}
                      min={0}
                      step="0.01"
                      required
                      className="border border-gray-200 rounded-lg pl-7 pr-3 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition w-full"
                    />
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg transition-colors shadow-sm"
                >
                  {editId ? "Update Challan" : "Save Challan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Modal */}
      {showViewModal && viewData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm overflow-y-auto p-6"
          onClick={(e) => e.target === e.currentTarget && setShowViewModal(false)}
        >
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden">

            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Challan Details</h2>
              <button
                onClick={() => setShowViewModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 space-y-5 max-h-[calc(100vh-200px)] overflow-y-auto">

              {/* Info Cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Party</p>
                  <p className="text-base font-semibold text-gray-900">{viewData.party_name}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Amount</p>
                  <p className="text-base font-semibold text-blue-600">₹{viewData.amount}</p>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Items</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-gray-200 rounded-lg">
                    <thead className="bg-gray-50">
                      <tr className="border-b border-gray-200">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Item</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Quantity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {viewData.items?.length > 0 ? (
                        viewData.items.map((item, index) => (
                          <tr key={index}>
                            <td className="px-4 py-3 text-gray-700">{item.name}</td>
                            <td className="px-4 py-3 text-right text-gray-600">{item.quantity}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="2" className="px-4 py-6 text-center text-gray-400">No items</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end px-6 py-4 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => setShowViewModal(false)}
                className="px-5 py-2 text-sm font-medium text-gray-600 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Modals */}
      <QuickAddItemModal
        isOpen={showQuickAddItem}
        onClose={() => setShowQuickAddItem(false)}
        onItemAdded={handleItemAdded}
      />
      <QuickAddPartyModal
        isOpen={showQuickAddParty}
        onClose={() => setShowQuickAddParty(false)}
        onPartyAdded={handlePartyAdded}
        defaultType="sundry_creditor"
      />
    </div>
  );
}